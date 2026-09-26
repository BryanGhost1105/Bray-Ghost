import { NextResponse } from 'next/server'
import { pool, ensureSchema } from '@/lib/db'
import { scrapeWebsite } from '@/lib/scraper'
import { generateEmail } from '@/lib/generator'
import { getAiApiKey } from '@/lib/ai'
import { sendBatch } from '@/lib/sender'
import { prepareFollowupDrafts, sendFollowUps } from '@/lib/followup'
import { sourceNoWebsiteEmails } from '@/lib/emailfinder'
import { enrichAllPendingLeads } from '@/lib/emailScraperEngine'
import {
  MAX_SEO_SCORE_TO_SEND,
  MAX_INITIAL_SENDS_PER_DAY,
  MAX_FOLLOWUPS_PER_DAY,
  MAX_EMAIL_SEARCHES_PER_RUN,
  MAX_SENDS_PER_RUN,
  MAX_FOLLOWUPS_PER_RUN,
  MAX_SCRAPES_PER_RUN,
  MAX_GENERATES_PER_RUN,
  RUN_BUDGET_MS,
  FOLLOWUP_DELAY_INTERVAL,
  BOUNCE_ALERT_THRESHOLD,
  COMPLAINT_ALERT_THRESHOLD,
} from '@/lib/constants'
import { recordError } from '@/lib/errors'
import { requireCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'

interface StageResult {
  success: boolean
  count?: number
  processed?: number
  error?: string
  bounces?: number
  complaints?: number
}

function exhausted(startedAt: number): boolean {
  return Date.now() - startedAt >= RUN_BUDGET_MS
}

async function remainingCapacity(): Promise<{ initial: number; followups: number }> {
  const settings = await pool.query('SELECT daily_cap, paused FROM settings WHERE id = 1')
  if (!settings.rows[0] || settings.rows[0].paused) return { initial: 0, followups: 0 }
  const counts = await pool.query(
    `SELECT
      (SELECT COUNT(*) FROM leads WHERE initial_sent_at >= CURRENT_DATE) AS initial,
      (SELECT COUNT(*) FROM leads WHERE followup_sent_at >= CURRENT_DATE) AS followups`
  )
  return {
    initial: Math.max(0, Math.min(Number(settings.rows[0].daily_cap), MAX_INITIAL_SENDS_PER_DAY) - Number(counts.rows[0].initial || 0)),
    followups: Math.max(0, MAX_FOLLOWUPS_PER_DAY - Number(counts.rows[0].followups || 0)),
  }
}

async function hasActionableWork(cap: { initial: number; followups: number }): Promise<boolean> {
  const pending = await pool.query(
    `SELECT
      (SELECT COUNT(*) FROM leads WHERE status = 'new') AS to_scrape,
      (SELECT COUNT(*) FROM leads WHERE status = 'scraped' AND email IS NOT NULL) AS to_generate,
      (SELECT COUNT(*) FROM leads WHERE status IN ('no_website', 'email_needed') AND email IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())) AS to_source,
      (SELECT COUNT(*) FROM leads WHERE status = 'generated' AND initial_sent_at IS NULL
        AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
        AND (seo_score IS NULL OR seo_score < $1)
        AND replied_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))) AS to_send,
      (SELECT COUNT(*) FROM leads WHERE status = 'sent' AND initial_sent_at <= NOW() - $2::interval
        AND followup_sent_at IS NULL AND replied_at IS NULL
        AND followup_approval_status = 'approved'
        AND followup_subject IS NOT NULL AND followup_body IS NOT NULL
        AND (followup_next_attempt_at IS NULL OR followup_next_attempt_at <= NOW())
        AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))) AS to_followup,
      (SELECT COUNT(*) FROM leads WHERE status = 'sent' AND initial_sent_at <= NOW() - $2::interval
        AND followup_sent_at IS NULL AND replied_at IS NULL
        AND followup_approval_status = 'pending'
        AND (followup_subject IS NULL OR followup_body IS NULL)
        AND followup_uncertain_at IS NULL
        AND (followup_next_attempt_at IS NULL OR followup_next_attempt_at <= NOW())
        AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))) AS to_prepare_followup`,
    [MAX_SEO_SCORE_TO_SEND, FOLLOWUP_DELAY_INTERVAL]
  )
  const row = pending.rows[0]
  const production = Number(row.to_scrape) + Number(row.to_generate) + Number(row.to_source)
  return (cap.initial > 0 && (production > 0 || Number(row.to_send) > 0)) ||
    (cap.followups > 0 && (Number(row.to_followup) > 0 || Number(row.to_prepare_followup) > 0))
}

async function sendHealth(): Promise<StageResult> {
  const result = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE reason = 'bounce' AND created_at > NOW() - INTERVAL '24 hours') AS bounces,
      COUNT(*) FILTER (WHERE reason = 'complaint' AND created_at > NOW() - INTERVAL '24 hours') AS complaints
     FROM suppressed_emails`
  )
  const bounces = Number(result.rows[0].bounces) || 0
  const complaints = Number(result.rows[0].complaints) || 0
  const errors: string[] = []
  if (bounces >= BOUNCE_ALERT_THRESHOLD) errors.push(`${bounces} bounces in the last 24 hours`)
  if (complaints >= COMPLAINT_ALERT_THRESHOLD) errors.push(`${complaints} complaint(s) in the last 24 hours`)
  return { success: errors.length === 0, bounces, complaints, ...(errors.length ? { error: errors.join('; ') } : {}) }
}

async function recordStageErrors(results: Record<string, StageResult>): Promise<void> {
  for (const [stage, result] of Object.entries(results)) {
    if (!result.success) {
      await recordError({
        source: 'pipeline',
        stage,
        message: result.error || 'Pipeline stage failed',
        context: { processed: result.processed ?? null, count: result.count ?? null },
      })
    }
  }
}

export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  const startedAt = Date.now()
  const results: Record<string, StageResult> = {}

  try {
    await ensureSchema()
    const settings = await pool.query('SELECT paused FROM settings WHERE id = 1')
    if (settings.rows[0]?.paused) {
      return NextResponse.json({ success: true, paused: true, hasRemaining: false })
    }

    if (!exhausted(startedAt)) {
      try {
        const result = await enrichAllPendingLeads(20)
        results.enrichment = { success: true, processed: result.totalProcessed, count: result.enrichedCount }
      } catch (error) {
        results.enrichment = { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    if (!exhausted(startedAt)) {
      try {
        const leads = await pool.query(
          `SELECT id FROM leads WHERE status = 'new' ORDER BY seo_score ASC NULLS LAST, created_at ASC LIMIT $1`,
          [MAX_SCRAPES_PER_RUN]
        )
        let processed = 0
        for (const lead of leads.rows) {
          if (exhausted(startedAt)) break
          await scrapeWebsite(lead.id)
          processed++
        }
        results.scraping = { success: true, processed }
      } catch (error) {
        results.scraping = { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    if (!exhausted(startedAt)) {
      try {
        const result = await sourceNoWebsiteEmails(MAX_EMAIL_SEARCHES_PER_RUN, () => exhausted(startedAt))
        results.emailSourcing = { success: result.failures.length === 0, processed: result.sourced, count: result.pending, ...(result.failures.length ? { error: result.failures.join('; ') } : {}) }
      } catch (error) {
        results.emailSourcing = { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    if (!exhausted(startedAt)) {
      const errors: string[] = []
      let processed = 0
      if (!getAiApiKey()) errors.push('AI_API_KEY or GEMINI_API_KEY is not configured.')
      else {
        const leads = await pool.query(
          `SELECT id FROM leads WHERE status = 'scraped' AND email IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM suppressed_emails se WHERE se.email = lower(leads.email))
           ORDER BY opportunity_score DESC NULLS LAST, seo_score ASC NULLS LAST LIMIT $1`,
          [MAX_GENERATES_PER_RUN]
        )
        for (const lead of leads.rows) {
          if (exhausted(startedAt)) break
          try {
            if (await generateEmail(lead.id)) processed++
          } catch (error) {
            errors.push(`Lead ${lead.id}: ${error instanceof Error ? error.message : String(error)}`)
          }
        }
      }
      results.generation = { success: errors.length === 0, processed, ...(errors.length ? { error: errors.join('; ') } : {}) }
    }

    if (!exhausted(startedAt)) {
      try {
        const drafts = await prepareFollowupDrafts(MAX_FOLLOWUPS_PER_RUN, () => exhausted(startedAt))
        results.followupDrafts = {
          success: drafts.rejected.length === 0,
          processed: drafts.prepared,
          ...(drafts.rejected.length ? { error: drafts.rejected.join('; ') } : {}),
        }
      } catch (error) {
        results.followupDrafts = { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    if (!exhausted(startedAt)) {
      try {
        const followups = await sendFollowUps(MAX_FOLLOWUPS_PER_RUN, () => exhausted(startedAt))
        results.followups = { success: followups.rejected.length === 0, processed: followups.sent, ...(followups.rejected.length ? { error: followups.rejected.join('; ') } : {}) }
      } catch (error) {
        results.followups = { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    if (!exhausted(startedAt)) {
      try {
        const sends = await sendBatch(MAX_SENDS_PER_RUN, () => exhausted(startedAt))
        results.initialSends = { success: sends.rejected.length === 0, processed: sends.sent, ...(sends.rejected.length ? { error: sends.rejected.join('; ') } : {}) }
      } catch (error) {
        results.initialSends = { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    }

    await pool.query('UPDATE settings SET last_run_at = NOW() WHERE id = 1')
    results.sendHealth = await sendHealth()
    const cap = await remainingCapacity()
    const blockingError = Object.values(results)
      .map((result) => result.error || '')
      .find((message) => /not configured|no valid email credentials|SENDER_POSTAL_ADDRESS/i.test(message))
    const hasRemaining = !blockingError && await hasActionableWork(cap)
    await recordStageErrors(results)
    return NextResponse.json({ success: true, autonomousMode: true, hasRemaining, results })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
