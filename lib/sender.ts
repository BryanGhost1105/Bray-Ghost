import { pool } from './db'
import { MAX_SEO_SCORE_TO_SEND, MAX_INITIAL_SENDS_PER_DAY, GMAIL_TIMEOUT_MS } from './constants'
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
         AND email_verification_status = 'source_verified'
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
  const uncertain = /send timeout/i.test(message)
  await pool.query(
    `UPDATE leads
     SET status = CASE WHEN $2 THEN 'send_uncertain' WHEN COALESCE(send_attempts, 0) >= 3 THEN 'failed' ELSE 'generated' END,
         send_claimed_at = NULL,
         send_uncertain_at = CASE WHEN $2 THEN NOW() ELSE send_uncertain_at END,
         initial_approval_status = CASE WHEN $2 THEN 'pending' ELSE initial_approval_status END,
         next_attempt_at = CASE WHEN $2 OR COALESCE(send_attempts, 0) >= 3 THEN NULL ELSE NOW() + INTERVAL '1 hour' END,
         send_last_error = $1
     WHERE id = $3 AND send_claimed_at IS NOT NULL`,
    [message.slice(0, 1000), uncertain, lead.id]
  )
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

  const body = appendComplianceFooter(lead.generated_body, lead.unsubscribe_token)

  try {
    if (!skipDelay) await sleep(sendDelayMs())
    const emailPromise = transporter.sendMail({
      from: fromEmail,
      to: lead.email,
      subject: lead.generated_subject,
      text: body,
      html: toHtml(body),
      replyTo,
      headers: complianceHeaders(lead.unsubscribe_token),
    })
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Gmail send timeout; review before retrying.')), GMAIL_TIMEOUT_MS)
    )
    const emailResponse = await Promise.race([emailPromise, timeoutPromise])
    const messageId = emailResponse.messageId || `gmail-${Date.now()}-${lead.id}`

    await pool.query(
      `UPDATE leads
       SET initial_sent_at = NOW(), initial_provider_id = $1, status = 'sent',
           send_claimed_at = NULL, next_attempt_at = NULL, send_last_error = NULL
       WHERE id = $2 AND send_claimed_at IS NOT NULL`,
      [messageId, lead.id]
    )
    return { sent: true, message: messageId }
  } catch (error) {
    await recordSendFailure(lead, error)
    return { sent: false, rejected: `Lead ${lead.id} (${lead.email}): ${error instanceof Error ? error.message : String(error)}` }
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
