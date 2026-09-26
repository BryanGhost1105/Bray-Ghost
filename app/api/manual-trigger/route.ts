import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { discoverBusinesses, type DiscoverResult } from '@/lib/discovery'
import { scrapeWebsite } from '@/lib/scraper'
import { generateEmail } from '@/lib/generator'
import { getAiApiKey } from '@/lib/ai'
import { sendBatch } from '@/lib/sender'
import { sourceNoWebsiteEmails } from '@/lib/emailfinder'
import {
  MAX_NICHES_PER_RUN,
  MAX_SCRAPES_PER_RUN,
  MAX_GENERATES_PER_RUN,
  MAX_EMAIL_SEARCHES_PER_RUN,
  MAX_SENDS_PER_RUN,
} from '@/lib/constants'
import { enrichAllPendingLeads } from '@/lib/emailScraperEngine'
import { requireInternalWriteAuth } from '@/lib/internalAuth'
import { ensureSchema } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const authError = requireInternalWriteAuth(request)
  if (authError) return authError
  await ensureSchema()

  try {
    const body = await request.json().catch(() => ({}))
    const action = body.action || 'pipeline' // 'discover' | 'pipeline' | 'full_cycle' | 'enrich_emails'

    const logs: string[] = []

    if (action === 'dry_run') {
      const summary = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'generated' AND initial_sent_at IS NULL) AS generated,
          COUNT(*) FILTER (WHERE status = 'generated' AND initial_sent_at IS NULL AND initial_approval_status = 'approved') AS approved,
          COUNT(*) FILTER (WHERE status = 'generated' AND initial_sent_at IS NULL AND initial_approval_status <> 'approved') AS awaiting_approval,
          COUNT(*) FILTER (WHERE status = 'sent' AND followup_sent_at IS NULL AND replied_at IS NULL AND followup_approval_status = 'approved') AS approved_followups
        FROM leads
      `)
      const row = summary.rows[0]
      logs.push('--- Safe outreach dry run ---')
      logs.push(`Generated drafts: ${Number(row.generated || 0)}`)
      logs.push(`Approved initial sends that the next approved-send run could dispatch: ${Number(row.approved || 0)}`)
      logs.push(`Drafts still awaiting human approval: ${Number(row.awaiting_approval || 0)}`)
      logs.push(`Approved follow-ups that could dispatch: ${Number(row.approved_followups || 0)}`)
      logs.push('No email provider was contacted and no lead state was changed.')
      return NextResponse.json({ success: true, action, logs, dryRun: true, timestamp: new Date().toISOString() })
    }

    if (action === 'enrich_emails') {
      logs.push('--- Starting Deep Email Scraper & Enrichment ---')
      try {
        const enrichResult = await enrichAllPendingLeads(50)
        logs.push(`Email Scraping completed: Enriched ${enrichResult.enrichedCount} out of ${enrichResult.totalProcessed} pending leads.`)
        for (const item of enrichResult.results.slice(0, 8)) {
          if (item.email) {
            logs.push(`✓ ${item.businessName}: ${item.email} (${item.emailConfidence} conf, via ${item.emailSource})`)
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logs.push(`Email scraping error: ${msg}`)
      }
    }

    if (action === 'discover' || action === 'full_cycle') {
      logs.push('--- Starting Business Discovery ---')
      
      const apiKey = process.env.GOOGLE_PLACES_API_KEY
      if (!apiKey) {
        logs.push('⚠️ Notice: GOOGLE_PLACES_API_KEY is not set in .env.local. Google Places discovery was skipped.')
      } else {
        const nichesResult = await pool.query(
          'SELECT id, label, city FROM niches WHERE status = $1 LIMIT $2',
          ['active', MAX_NICHES_PER_RUN]
        )
        const niches = nichesResult.rows

        let totalDiscovered = 0
        for (const niche of niches) {
          try {
            const result: DiscoverResult = await discoverBusinesses(niche.label, niche.city, niche.id)
            totalDiscovered += result.inserted
            if (result.error) {
              logs.push(`Niche "${niche.label} in ${niche.city}": blocked (${result.error})`)
            } else {
              logs.push(`Niche "${niche.label} in ${niche.city}": ${result.inserted} new leads inserted (status: ${result.status})`)
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            logs.push(`Error discovering "${niche.label} in ${niche.city}": ${msg}`)
          }
        }
        logs.push(`Discovery finished: ${totalDiscovered} total new leads added.`)

        // Automatically run email scraper enrichment on all new leads
        try {
          const enrichResult = await enrichAllPendingLeads(30)
          if (enrichResult.enrichedCount > 0) {
            logs.push(`⚡ Email Enrichment: Automatically discovered ${enrichResult.enrichedCount} email addresses for new leads!`)
          }
        } catch {
          // ignore
        }
      }
    }

    if (action === 'pipeline' || action === 'full_cycle') {
      logs.push('--- Starting Outreach Pipeline ---')

      // 1. Scrape & Audit 'new' leads (6-dimensional website audit + email extraction)
      const newLeads = await pool.query(
        'SELECT id, business_name, website FROM leads WHERE status = $1 ORDER BY seo_score ASC NULLS LAST LIMIT $2',
        ['new', MAX_SCRAPES_PER_RUN]
      )

      let scrapedCount = 0
      let auditedCount = 0
      for (const lead of newLeads.rows) {
        try {
          const ok = await scrapeWebsite(lead.id)
          auditedCount++
          if (ok) scrapedCount++
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err)
          logs.push(`Audit error on ${lead.business_name}: ${msg}`)
        }
      }
      logs.push(`Website Audits: ${auditedCount} sites analyzed, ${scrapedCount} emails discovered.`)

      // 2. Email sourcing for no-website / email-needed leads
      try {
        const { sourced, pending, failures } = await sourceNoWebsiteEmails(MAX_EMAIL_SEARCHES_PER_RUN)
        logs.push(`Email sourcing: ${sourced} emails found via search, ${pending} leads still pending.`)
        if (failures.length > 0) {
          logs.push(`Search issues: ${failures.join('; ')}`)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        logs.push(`Email search error: ${msg}`)
      }

      // 3. AI Email Generation for 'scraped' leads (uses audit intelligence)
      const aiKey = getAiApiKey()
      if (!aiKey) {
        logs.push('⚠️ AI API Key missing: Cannot generate emails until AI_API_KEY or GEMINI_API_KEY is configured.')
      } else {
        const scrapedLeads = await pool.query(
          `SELECT l.id, l.business_name, l.outreach_angle FROM leads l
           WHERE l.status = 'scraped' AND l.email IS NOT NULL
           ORDER BY l.opportunity_score DESC NULLS LAST, l.seo_score ASC NULLS LAST
           LIMIT $1`,
          [MAX_GENERATES_PER_RUN]
        )

        let generatedCount = 0
        for (const lead of scrapedLeads.rows) {
          try {
            const ok = await generateEmail(lead.id)
            if (ok) generatedCount++
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err)
            logs.push(`AI Generation error on ${lead.business_name}: ${msg}`)
          }
        }
        logs.push(`AI Emails Generated: ${generatedCount} personalized pitches created (angle-targeted).`)
      }

      // Prepare due follow-up drafts for a human to review. Preparation never
      // approves or sends a follow-up.
      try {
        const { prepareFollowupDrafts } = await import('@/lib/followup')
        const draftResult = await prepareFollowupDrafts(2)
        logs.push(`Follow-up drafts prepared: ${draftResult.prepared} awaiting human approval.`)
        if (draftResult.rejected.length > 0) logs.push(`Follow-up draft issues: ${draftResult.rejected.join('; ')}`)
      } catch (err: unknown) {
        logs.push(`Follow-up draft preparation error: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (action === 'send_outreach' || action === 'pipeline' || action === 'full_cycle') {
      // Sending generated emails with human mimicry delays (20-40s) up to daily cap
      try {
        const sendResult = await sendBatch(MAX_SENDS_PER_RUN)
        if (sendResult.sent > 0) {
          logs.push(`🚀 Dispatch: ${sendResult.sent} emails successfully sent via personal Gmail with human-like delays (20–40s spacing).`)
        } else {
          logs.push(`Dispatch: 0 initial emails sent (ensure leads are in "generated" status and daily cap has remaining allowance).`)
        }
        if (sendResult.rejected.length > 0) {
          logs.push(`Send notices: ${sendResult.rejected.join('; ')}`)
        }

        // Also check if any followups are due (4+ days gap)
        const { sendFollowUps } = await import('@/lib/followup')
        const followupResult = await sendFollowUps(2)
        if (followupResult.sent > 0) {
          logs.push(`📬 Follow-ups: ${followupResult.sent} follow-up emails sent (4+ days interval).`)
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('No valid email credentials found')) {
          logs.push('ℹ️ Sending skipped: Gmail is not connected yet. Connect via Google OAuth in Pipeline Settings.')
        } else {
          logs.push(`Sending notice: ${msg}`)
        }
      }

      // Update last_run_at
      await pool.query('UPDATE settings SET last_run_at = NOW() WHERE id = 1')
    }

    return NextResponse.json({
      success: true,
      action,
      logs,
      timestamp: new Date().toISOString(),
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
