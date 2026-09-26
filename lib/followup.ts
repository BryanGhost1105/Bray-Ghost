import { pool } from './db'
import { MAX_FOLLOWUPS_PER_DAY, GMAIL_TIMEOUT_MS, FOLLOWUP_DELAY_INTERVAL } from './constants'
import { toHtml, sendDelayMs, sleep } from './emailFormat'
import { callDeepSeekJson, parseEmailResponse, getAiApiKey } from './ai'
import { getEmailSender } from './transporter'
import { appendComplianceFooter, assertEmailComplianceConfiguration, complianceHeaders } from './compliance'

export interface SendFollowUpsResult {
  sent: number
  rejected: string[]
}

interface FollowupLead {
  id: string
  business_name: string
  email: string | null
  generated_subject: string | null
  followup_subject: string | null
  followup_body: string | null
  unsubscribe_token: string
}

export async function sendFollowUps(
  maxFollowups: number,
  isExhausted?: () => boolean
): Promise<SendFollowUpsResult> {
  assertEmailComplianceConfiguration()
  const { transporter, fromEmail, replyTo } = await getEmailSender()
  if (!getAiApiKey()) throw new Error('AI_API_KEY or GEMINI_API_KEY is not set in environment variables.')

  const settingsResult = await pool.query('SELECT paused FROM settings WHERE id = 1')
  if (settingsResult.rows.length === 0) throw new Error('Settings table row with id = 1 not found.')
  if (settingsResult.rows[0].paused) return { sent: 0, rejected: [] }

  const countResult = await pool.query(
    'SELECT COUNT(*)::int AS count FROM leads WHERE followup_sent_at >= CURRENT_DATE'
  )
  const remaining = MAX_FOLLOWUPS_PER_DAY - (Number(countResult.rows[0].count) || 0)
  if (remaining <= 0) return { sent: 0, rejected: [] }

  const rejected: string[] = []
  let sent = 0

  for (let index = 0; index < Math.min(maxFollowups, remaining); index++) {
    if (isExhausted?.()) break

    const leadResult = await pool.query(
      `WITH candidate AS (
         SELECT id FROM leads
         WHERE status = 'sent'
           AND initial_sent_at <= NOW() - $1::interval
           AND followup_sent_at IS NULL
           AND followup_approval_status = 'approved'
           AND replied_at IS NULL
           AND (followup_claimed_at IS NULL OR followup_claimed_at < NOW() - INTERVAL '20 minutes')
           AND (followup_next_attempt_at IS NULL OR followup_next_attempt_at <= NOW())
           AND COALESCE(followup_attempts, 0) < 3
           AND email IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))
         ORDER BY initial_sent_at ASC
         LIMIT 1
       )
       UPDATE leads
       SET followup_claimed_at = NOW(), followup_attempts = COALESCE(followup_attempts, 0) + 1
       WHERE leads.id = (SELECT id FROM candidate)
       RETURNING id, business_name, email, generated_subject, followup_subject, followup_body, unsubscribe_token`,
      [FOLLOWUP_DELAY_INTERVAL]
    )
    const lead = leadResult.rows[0] as FollowupLead | undefined
    if (!lead) break

    let subject = lead.followup_subject
    let body = lead.followup_body
    if (!subject || !body) {
      try {
        const emailData = await callDeepSeekJson(
          `You are an independent freelance web developer writing a short follow-up email to a local business owner.
Rules: 2-3 sentences, casual human tone, no em dashes, no corporate filler, and do not repeat the full pitch.
Return strict JSON: {"subject":"string","body":"string"}
Business Name: ${lead.business_name}
Previous Subject: ${lead.generated_subject || ''}`,
          `Generate a brief follow-up for ${lead.business_name}.`,
          parseEmailResponse
        )
        subject = emailData.subject
        body = emailData.body
        await pool.query(
          'UPDATE leads SET followup_subject = $1, followup_body = $2 WHERE id = $3 AND followup_claimed_at IS NOT NULL',
          [subject, body, lead.id]
        )
      } catch (error) {
        await releaseFollowup(lead.id, error)
        rejected.push(`Lead ${lead.id} (${lead.business_name}): follow-up generation failed: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
    }

    if (!lead.email || !subject || !body || !lead.unsubscribe_token) {
      await releaseFollowup(lead.id, new Error('Missing follow-up send data.'))
      rejected.push(`Lead ${lead.id}: missing follow-up data.`)
      continue
    }

    try {
      await sleep(sendDelayMs())
      const fullBody = appendComplianceFooter(body, lead.unsubscribe_token)
      const emailPromise = transporter.sendMail({
        from: fromEmail,
        to: lead.email,
        subject,
        text: fullBody,
        html: toHtml(fullBody),
        replyTo,
        headers: complianceHeaders(lead.unsubscribe_token),
      })
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gmail follow-up timeout; review before retrying.')), GMAIL_TIMEOUT_MS)
      )
      const response = await Promise.race([emailPromise, timeoutPromise])
      const messageId = response.messageId || `gmail-${Date.now()}-${lead.id}`
      await pool.query(
        `UPDATE leads SET followup_sent_at = NOW(), followup_provider_id = $1,
         status = 'followed_up', followup_claimed_at = NULL,
         followup_next_attempt_at = NULL WHERE id = $2 AND followup_claimed_at IS NOT NULL`,
        [messageId, lead.id]
      )
      sent++
    } catch (error) {
      await releaseFollowup(lead.id, error)
      rejected.push(`Lead ${lead.id} (${lead.email}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return { sent, rejected }
}

async function releaseFollowup(leadId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  await pool.query(
    `UPDATE leads SET followup_claimed_at = NULL,
      followup_next_attempt_at = CASE WHEN COALESCE(followup_attempts, 0) >= 3 THEN NULL ELSE NOW() + INTERVAL '1 day' END,
      send_last_error = $1
     WHERE id = $2`,
    [message.slice(0, 1000), leadId]
  )
}
