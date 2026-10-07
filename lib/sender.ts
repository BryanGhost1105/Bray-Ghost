import { pool } from './db'
import { MAX_SEO_SCORE_TO_SEND, MAX_INITIAL_SENDS_PER_DAY } from './constants'
import { toHtml, sendDelayMs, sleep } from './emailFormat'
import { getEmailSender } from './transporter'
import { appendComplianceFooter, assertEmailComplianceConfiguration, complianceHeaders } from './compliance'

export interface SendBatchResult {
  sent: number
  rejected: string[]
}

interface ClaimedLead {
  id: string
  email: string | null
  generated_subject: string | null
  generated_body: string | null
  unsubscribe_token: string
}

export interface SendOneResult {
  sent: boolean
  message?: string
  rejected?: string
}

async function claimLead(leadId?: string): Promise<ClaimedLead | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const settingsResult = await client.query(
      'SELECT daily_cap, paused FROM settings WHERE id = 1 FOR UPDATE'
    )
    if (settingsResult.rows.length === 0) throw new Error('Settings table row with id = 1 not found.')

    const settings = settingsResult.rows[0]
    if (settings.paused) {
      await client.query('COMMIT')
      return null
    }

    const countResult = await client.query(
      'SELECT COUNT(*)::int AS count FROM leads WHERE initial_sent_at >= CURRENT_DATE'
    )
    const sentToday = Number(countResult.rows[0].count) || 0
    const remaining = Math.min(Number(settings.daily_cap), MAX_INITIAL_SENDS_PER_DAY) - sentToday
    if (remaining <= 0) {
      await client.query('COMMIT')
      return null
    }

    const result = await client.query(
      `WITH candidate AS (
         SELECT id FROM leads
         WHERE ($2::uuid IS NULL OR id = $2::uuid)
         AND status = 'generated'
         AND generation_policy_version = 'permission-v1'
         AND initial_approval_status = 'approved'
         AND send_uncertain_at IS NULL
         AND email_verification_status = 'operator_verified'
         AND email_verified_at >= NOW() - INTERVAL '30 days'
         AND (seo_score IS NULL OR seo_score < $1)
         AND initial_sent_at IS NULL
         AND replied_at IS NULL
         AND (send_claimed_at IS NULL OR send_claimed_at < NOW() - INTERVAL '20 minutes')
         AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
         AND email IS NOT NULL
         AND generated_subject IS NOT NULL
         AND generated_body IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email)
         )
         ORDER BY seo_score ASC NULLS LAST, opportunity_score DESC NULLS LAST, created_at ASC
         LIMIT 1
       )
       UPDATE leads
       SET send_claimed_at = NOW(), send_attempts = COALESCE(send_attempts, 0) + 1
       WHERE leads.id = (SELECT id FROM candidate)
       RETURNING id, email, generated_subject, generated_body, unsubscribe_token`,
      [MAX_SEO_SCORE_TO_SEND, leadId || null]
    )
    await client.query('COMMIT')
    return result.rows[0] || null
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

async function recordSendFailure(lead: ClaimedLead, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  await pool.query(
    `UPDATE leads
     SET status = CASE WHEN COALESCE(send_attempts, 0) >= 3 THEN 'failed' ELSE 'generated' END,
         send_claimed_at = NULL,
         next_attempt_at = CASE WHEN COALESCE(send_attempts, 0) >= 3 THEN NULL ELSE NOW() + INTERVAL '1 hour' END,
         send_last_error = $1
     WHERE id = $2 AND send_claimed_at IS NOT NULL AND status = 'generated' AND initial_sent_at IS NULL`,
    [message.slice(0, 1000), lead.id]
  )
}

async function markSendOutcomeUncertain(lead: ClaimedLead): Promise<boolean> {
  const result = await pool.query(
    `UPDATE leads
     SET status = 'send_uncertain', send_uncertain_at = NOW(),
         initial_approval_status = 'pending', initial_approved_at = NULL,
         initial_approved_by = NULL, next_attempt_at = NULL,
         send_last_error = 'A send attempt was started; verify the mailbox before retrying.'
     WHERE id = $1 AND status = 'generated' AND initial_approval_status = 'approved'
       AND send_claimed_at IS NOT NULL AND initial_sent_at IS NULL
     RETURNING id`,
    [lead.id]
  )
  return result.rowCount === 1
}

export async function sendSingleLead(leadId: string, skipDelay = false): Promise<SendOneResult> {
  assertEmailComplianceConfiguration()
  const { transporter, fromEmail, replyTo } = await getEmailSender()
  const lead = await claimLead(leadId || undefined)

  if (!lead) {
    return {
      sent: false,
      rejected: 'Lead is not ready, is already claimed/sent, is suppressed, or the daily cap is exhausted.',
    }
  }

  if (!lead.email || !lead.generated_subject || !lead.generated_body || !lead.unsubscribe_token) {
    await recordSendFailure(lead, new Error('Missing email, generated content, or unsubscribe token.'))
    return { sent: false, rejected: `Lead ${lead.id}: missing send data.` }
  }

  try {
    if (!skipDelay) await sleep(sendDelayMs())
  } catch (error) {
    await recordSendFailure(lead, error)
    return { sent: false, rejected: `Lead ${lead.id}: send stopped before contacting Gmail: ${error instanceof Error ? error.message : String(error)}` }
  }

  let body: string
  try {
    body = appendComplianceFooter(lead.generated_body, lead.unsubscribe_token)
    // Persist a no-retry state before the external side effect. If the process
    // crashes after Gmail accepts the message (or the confirmation DB write
    // fails), this row cannot return to the automatic send queue.
    const markedUncertain = await markSendOutcomeUncertain(lead)
    if (!markedUncertain) {
      return { sent: false, rejected: `Lead ${lead.id}: send claim or approval changed before Gmail was contacted.` }
    }
  } catch (error) {
    await recordSendFailure(lead, error).catch(() => undefined)
    return { sent: false, rejected: `Lead ${lead.id}: could not safely record send intent; Gmail was not contacted: ${error instanceof Error ? error.message : String(error)}` }
  }

  let emailResponse: Awaited<ReturnType<typeof transporter.sendMail>>
  try {
    const emailPromise = transporter.sendMail({
      from: fromEmail,
      to: lead.email,
      subject: lead.generated_subject,
      text: body,
      html: toHtml(body),
      replyTo,
      headers: complianceHeaders(lead.unsubscribe_token),
    })
    emailResponse = await emailPromise
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await pool.query(
      `UPDATE leads SET send_last_error = $1
       WHERE id = $2 AND status = 'send_uncertain' AND send_uncertain_at IS NOT NULL`,
      [message.slice(0, 1000), lead.id]
    ).catch(() => undefined)
    return { sent: false, rejected: `Lead ${lead.id} (${lead.email}): provider outcome is uncertain; verify the mailbox before any retry. ${message}` }
  }

  const messageId = emailResponse.messageId || `gmail-${Date.now()}-${lead.id}`
  try {
    const recorded = await pool.query(
      `UPDATE leads
       SET initial_sent_at = NOW(), initial_provider_id = $1, status = 'sent',
           send_claimed_at = NULL, next_attempt_at = NULL, send_last_error = NULL,
           send_uncertain_at = NULL
       WHERE id = $2 AND send_claimed_at IS NOT NULL AND status = 'send_uncertain'
         AND send_uncertain_at IS NOT NULL AND initial_sent_at IS NULL`,
      [messageId, lead.id]
    )
    if (recorded.rowCount !== 1) {
      return { sent: false, rejected: `Lead ${lead.id}: Gmail accepted the email (${messageId}), but local send confirmation was not recorded; verify the mailbox.` }
    }
    return { sent: true, message: messageId }
  } catch (error) {
    return { sent: false, rejected: `Lead ${lead.id}: Gmail accepted the email (${messageId}), but local send confirmation failed; verify the mailbox before any retry. ${error instanceof Error ? error.message : String(error)}` }
  }
}

export async function sendBatch(
  maxSends: number,
  isExhausted?: () => boolean
): Promise<SendBatchResult> {
  const rejected: string[] = []
  let sent = 0

  for (let index = 0; index < maxSends; index++) {
    if (isExhausted?.()) break
    const result = await sendSingleLead('', false)
    if (result.sent) {
      sent++
      continue
    }
    if (result.rejected) rejected.push(result.rejected)
    break
  }

  return { sent, rejected }
}
