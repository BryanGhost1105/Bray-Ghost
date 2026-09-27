import { NextResponse } from 'next/server'
import { pool, ensureSchema } from '@/lib/db'
import { scrapeWebsite } from '@/lib/scraper'
import { generateEmail } from '@/lib/generator'
import { sendSingleLead } from '@/lib/sender'
import { findEmailViaSearch } from '@/lib/emailfinder'
import { isSuppressedEmail } from '@/lib/suppression'
import { requireInternalWriteAuth } from '@/lib/internalAuth'
import { isValidBusinessEmail } from '@/lib/emailQuality'
import { enrichLeadEmail } from '@/lib/emailScraperEngine'

export const dynamic = 'force-dynamic'

/**
 * DELETE /api/leads
 * Supports deleting a single lead, a list of lead IDs, or purging test data.
 */
export async function DELETE(request: Request) {
  const authError = requireInternalWriteAuth(request)
  if (authError) return authError
  await ensureSchema()

  try {
    const body = await request.json().catch(() => ({}))
    const { leadId, leadIds, clearAll, clearStatus, clearSuppressed } = body

    if (leadId) {
      const res = await pool.query('DELETE FROM leads WHERE id = $1 RETURNING id, business_name', [leadId])
      if (res.rowCount === 0) {
        return NextResponse.json({ success: false, error: 'Lead not found.' }, { status: 404 })
      }
      return NextResponse.json({
        success: true,
        message: `Deleted lead "${res.rows[0].business_name}".`,
        deletedId: leadId,
      })
    }

    if (Array.isArray(leadIds) && leadIds.length > 0) {
      const res = await pool.query('DELETE FROM leads WHERE id = ANY($1::uuid[]) RETURNING id', [leadIds])
      return NextResponse.json({
        success: true,
        message: `Deleted ${res.rowCount} selected leads.`,
        deletedCount: res.rowCount,
      })
    }

    if (clearStatus) {
      const res = await pool.query('DELETE FROM leads WHERE status = $1 RETURNING id', [clearStatus])
      return NextResponse.json({
        success: true,
        message: `Deleted ${res.rowCount} leads with status "${clearStatus}".`,
        deletedCount: res.rowCount,
      })
    }

    if (clearAll) {
      const res = await pool.query('DELETE FROM leads RETURNING id')
      let suppressedPlacesDeleted = 0
      let suppressedEmailsDeleted = 0

      if (clearSuppressed) {
        const pRes = await pool.query('DELETE FROM suppressed_places RETURNING place_id')
        const eRes = await pool.query('DELETE FROM suppressed_emails RETURNING email')
        suppressedPlacesDeleted = pRes.rowCount || 0
        suppressedEmailsDeleted = eRes.rowCount || 0
      }

      return NextResponse.json({
        success: true,
        message: `Cleared all ${res.rowCount} leads.${
          clearSuppressed
            ? ` Reset ${suppressedPlacesDeleted} suppressed places & ${suppressedEmailsDeleted} suppressed emails.`
            : ''
        }`,
        deletedCount: res.rowCount,
      })
    }

    return NextResponse.json(
      { success: false, error: 'Please specify leadId, leadIds, clearStatus, or clearAll.' },
      { status: 400 }
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * PATCH /api/leads
 * Updates editable lead details (business name, email, website, phone, status, address).
 */
export async function PATCH(request: Request) {
  const authError = requireInternalWriteAuth(request)
  if (authError) return authError
  await ensureSchema()

  try {
    const body = await request.json().catch(() => ({}))
    const { leadId, business_name, email, website, phone, address, status } = body

    if (!leadId) {
      return NextResponse.json({ success: false, error: 'leadId is required.' }, { status: 400 })
    }

    const currentRes = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId])
    if (currentRes.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Lead not found.' }, { status: 404 })
    }

    const current = currentRes.rows[0]
    const updatedName = business_name !== undefined ? business_name : current.business_name
    const updatedEmail = email !== undefined ? email : current.email
    const updatedWebsite = website !== undefined ? website : current.website
    const updatedPhone = phone !== undefined ? phone : current.phone
    const updatedAddress = address !== undefined ? address : current.address
    let updatedStatus = status !== undefined ? status : current.status

    const allowedStatuses = new Set(['new', 'email_needed', 'scraped', 'generated', 'sent', 'followed_up', 'no_website', 'failed', 'send_uncertain', 'unsubscribed'])
    if (status !== undefined && !allowedStatuses.has(String(status))) {
      return NextResponse.json({ success: false, error: 'Invalid lead status.' }, { status: 400 })
    }
    if (updatedEmail && !isValidBusinessEmail(String(updatedEmail).trim().toLowerCase())) {
      return NextResponse.json({ success: false, error: 'Enter a valid business email address.' }, { status: 400 })
    }
    if (updatedEmail && await isSuppressedEmail(String(updatedEmail).trim().toLowerCase())) {
      return NextResponse.json({ success: false, error: 'This email address is suppressed.' }, { status: 400 })
    }

    // Auto-transition: if a no_website or email_needed lead just received an email, move to scraped
    const hadNoEmail = !current.email || current.email.trim() === ''
    const nowHasEmail = updatedEmail && updatedEmail.trim() !== ''
    const stuckStatuses = ['no_website', 'email_needed', 'new']
    if (hadNoEmail && nowHasEmail && stuckStatuses.includes(current.status) && status === undefined) {
      updatedStatus = 'scraped'
    }

    const result = await pool.query(
      `UPDATE leads SET
         business_name = $1,
         email = $2,
         website = $3,
         phone = $4,
         address = $5,
         status = $6
       WHERE id = $7
       RETURNING *`,
      [updatedName, updatedEmail, updatedWebsite, updatedPhone, updatedAddress, updatedStatus, leadId]
    )

    const autoTransitioned = hadNoEmail && nowHasEmail && stuckStatuses.includes(current.status) && status === undefined

    return NextResponse.json({
      success: true,
      lead: result.rows[0],
      message: `Lead "${updatedName}" updated successfully.${autoTransitioned ? ' Status auto-transitioned to "scraped" (ready for pitch generation).' : ''}`,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

/**
 * POST /api/leads
 * Handles custom lead actions: reaudit, regenerate, or add_manual
 */
export async function POST(request: Request) {
  const authError = requireInternalWriteAuth(request)
  if (authError) return authError
  await ensureSchema()

  try {
    const body = await request.json().catch(() => ({}))
    const { action, leadId, business_name, email, website, city } = body

    if (action === 'reaudit') {
      if (!leadId) {
        return NextResponse.json({ success: false, error: 'leadId is required.' }, { status: 400 })
      }

      // Run website scrape & multi-dimensional audit
      const scrapedOk = await scrapeWebsite(leadId)

      // Optionally re-generate pitch if email exists
      let generatedOk = false
      const leadCheck = await pool.query('SELECT email FROM leads WHERE id = $1', [leadId])
      if (leadCheck.rows[0]?.email) {
        try {
          generatedOk = await generateEmail(leadId)
        } catch {
          // ignore pitch error on audit
        }
      }

      const updatedLead = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId])

      return NextResponse.json({
        success: true,
        lead: updatedLead.rows[0],
        scrapedOk,
        generatedOk,
        message: `Audited lead successfully! Status: ${updatedLead.rows[0]?.status}`,
      })
    }

    if (action === 'regenerate') {
      if (!leadId) {
        return NextResponse.json({ success: false, error: 'leadId is required.' }, { status: 400 })
      }

      const ok = await generateEmail(leadId)
      if (!ok) {
        return NextResponse.json({
          success: false,
          error: 'Failed to generate pitch. Ensure the lead has a valid email address.',
        })
      }

      const updatedLead = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId])
      return NextResponse.json({
        success: true,
        lead: updatedLead.rows[0],
        message: 'Personalized pitch generated successfully with grounded facts!',
      })
    }

    if (action === 'add_manual') {
      if (!business_name || !email) {
        return NextResponse.json(
          { success: false, error: 'business_name and email are required.' },
          { status: 400 }
        )
      }

      if (!isValidBusinessEmail(String(email).trim().toLowerCase())) {
        return NextResponse.json({ success: false, error: 'Enter a valid business email address.' }, { status: 400 })
      }

      const insertRes = await pool.query(
        `INSERT INTO leads (business_name, email, website, address, status)
         VALUES ($1, $2, $3, $4, 'new')
         RETURNING *`,
        [business_name, email, website || null, city || null]
      )

      const newLead = insertRes.rows[0]

      // Automatically audit if website is provided
      if (website && website.trim() !== '') {
        try {
          await scrapeWebsite(newLead.id)
          await generateEmail(newLead.id)
        } catch {
          // non-blocking
        }
      }

      const finalLead = await pool.query('SELECT * FROM leads WHERE id = $1', [newLead.id])

      return NextResponse.json({
        success: true,
        lead: finalLead.rows[0],
        message: `Added lead "${business_name}" to queue.`,
      })
    }

    if (action === 'approve_send' || action === 'approve_bulk') {
      const requestedIds = action === 'approve_send' ? [leadId] : body.leadIds
      if (!Array.isArray(requestedIds) || requestedIds.length === 0 || requestedIds.some((id) => typeof id !== 'string')) {
        return NextResponse.json({ success: false, error: action === 'approve_send' ? 'leadId is required.' : 'leadIds array is required.' }, { status: 400 })
      }

      const approved: string[] = []
      const skipped: string[] = []
      for (const id of requestedIds) {
        const result = await pool.query(
          `UPDATE leads
           SET initial_approval_status = 'approved',
               initial_approved_at = NOW(),
               initial_approved_by = 'internal-operator'
           WHERE id = $1
             AND status = 'generated'
             AND generation_policy_version = 'permission-v1'
             AND generated_subject IS NOT NULL
             AND generated_body IS NOT NULL
             AND initial_sent_at IS NULL
             AND replied_at IS NULL
             AND status <> 'unsubscribed'
           RETURNING id, business_name`,
          [id]
        )
        if (result.rows[0]) approved.push(result.rows[0].business_name)
        else skipped.push(String(id))
      }

      return NextResponse.json({
        success: true,
        approvedCount: approved.length,
        skippedCount: skipped.length,
        approved,
        skipped,
        message: approved.length
          ? `${approved.length} draft${approved.length === 1 ? '' : 's'} approved for sending. No email was sent by this action.`
          : 'No eligible generated drafts were approved.',
      })
    }

    if (action === 'revoke_approval') {
      if (!leadId) {
        return NextResponse.json({ success: false, error: 'leadId is required.' }, { status: 400 })
      }

      const result = await pool.query(
        `UPDATE leads
         SET initial_approval_status = 'pending',
             initial_approved_at = NULL,
             initial_approved_by = NULL
         WHERE id = $1 AND initial_sent_at IS NULL
         RETURNING id, business_name`,
        [leadId]
      )

      if (!result.rows[0]) {
        return NextResponse.json({ success: false, error: 'Lead was not found or has already been sent.' }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        message: `Approval revoked for ${result.rows[0].business_name}. No email was sent.`,
      })
    }

    if (action === 'approve_followup' || action === 'revoke_followup') {
      if (!leadId) {
        return NextResponse.json({ success: false, error: 'leadId is required.' }, { status: 400 })
      }

      const approving = action === 'approve_followup'
      const result = await pool.query(
        `UPDATE leads
         SET followup_approval_status = $1,
             followup_approved_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
             followup_approved_by = CASE WHEN $2 THEN 'internal-operator' ELSE NULL END
         WHERE id = $3
           AND status = 'sent'
           AND followup_sent_at IS NULL
           AND replied_at IS NULL
           AND followup_uncertain_at IS NULL
           AND followup_subject IS NOT NULL
           AND followup_body IS NOT NULL
         RETURNING id, business_name` ,
        [approving ? 'approved' : 'pending', approving, leadId]
      )

      if (!result.rows[0]) {
        return NextResponse.json({
          success: false,
          error: approving
            ? 'No complete, unsent follow-up draft is ready for approval.'
            : 'Follow-up was not found or has already been sent.',
        }, { status: 404 })
      }

      return NextResponse.json({
        success: true,
        message: approving
          ? `Follow-up approved for ${result.rows[0].business_name}. No email was sent.`
          : `Follow-up approval revoked for ${result.rows[0].business_name}. No email was sent.`,
      })
    }

    if (action === 'send_bulk') {
      return NextResponse.json(
        { success: false, error: 'Bulk dispatch is disabled. Approve generated drafts individually or with approve_bulk, then run the approved-send step.' },
        { status: 410 }
      )
    }

    if (action === 'send_single') {
      if (!leadId) {
        return NextResponse.json({ success: false, error: 'leadId is required.' }, { status: 400 })
      }

      const leadRes = await pool.query(
        'SELECT id, email, generated_subject, generated_body, status, website, replied_at FROM leads WHERE id = $1',
        [leadId]
      )
      if (leadRes.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Lead not found.' }, { status: 404 })
      }

      const lead = leadRes.rows[0]

      if (!lead.email || lead.email.trim() === '') {
        return NextResponse.json({
          success: false,
          error: 'This lead does not have an email address. Please edit the lead to add an email or click "Find Email" first.',
        }, { status: 400 })
      }

      if (await isSuppressedEmail(lead.email)) {
        return NextResponse.json({
          success: false,
          error: 'This email address is suppressed (previously bounced or unsubscribed).',
        }, { status: 400 })
      }

      if (lead.replied_at || lead.status === 'unsubscribed') {
        return NextResponse.json({ success: false, error: 'This lead has replied or unsubscribed and cannot receive outreach.' }, { status: 400 })
      }

      // If pitch has not been generated yet, automatically generate it on the fly!
      let subject = lead.generated_subject
      let bodyText = lead.generated_body

      if (!subject || !bodyText) {
        // If the website hasn't been scraped yet, try scraping first if website exists
        if (lead.website && lead.status === 'new') {
          try {
            await scrapeWebsite(lead.id)
          } catch { /* proceed */ }
        }

        const generatedOk = await generateEmail(lead.id)
        if (!generatedOk) {
          return NextResponse.json({
            success: false,
            error: 'Failed to generate personalized email pitch. Please check your AI API key in settings.',
          }, { status: 400 })
        }

        const refreshed = await pool.query('SELECT generated_subject, generated_body FROM leads WHERE id = $1', [lead.id])
        subject = refreshed.rows[0]?.generated_subject
        bodyText = refreshed.rows[0]?.generated_body
      }

      if (!subject || !bodyText) {
        return NextResponse.json({
          success: false,
          error: 'Could not prepare email subject/body for this lead.',
        }, { status: 400 })
      }

      const sendResult = await sendSingleLead(lead.id, true)
      if (!sendResult.sent) {
        return NextResponse.json({ success: false, error: sendResult.rejected || 'Gmail did not accept the message.' }, { status: 400 })
      }

      const updatedLead = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId])
      return NextResponse.json({
        success: true,
        lead: updatedLead.rows[0],
        message: `Outreach email dispatched via Gmail to ${lead.email} successfully!`,
      })
    }

    if (action === 'send_bulk') {
      const { leadIds } = body
      if (!Array.isArray(leadIds) || leadIds.length === 0) {
        return NextResponse.json({ success: false, error: 'leadIds array is required.' }, { status: 400 })
      }

      let sentCount = 0
      const skipped: string[] = []
      const failures: string[] = []
      for (const id of leadIds) {
        const leadRes = await pool.query(
          'SELECT id, business_name, email, generated_subject, generated_body, status, website, replied_at, initial_sent_at FROM leads WHERE id = $1',
          [id]
        )
        if (leadRes.rows.length === 0) continue
        const lead = leadRes.rows[0]

        if (!lead.email || lead.email.trim() === '') {
          skipped.push(`"${lead.business_name}": missing email address`)
          continue
        }

        if (await isSuppressedEmail(lead.email)) {
          skipped.push(`"${lead.business_name}": email suppressed`)
          continue
        }

        if (lead.replied_at || lead.status === 'unsubscribed' || lead.initial_sent_at) {
          skipped.push(`"${lead.business_name}": already contacted or suppressed by reply`)
          continue
        }

        let subject = lead.generated_subject
        let bodyText = lead.generated_body

        if (!subject || !bodyText) {
          if (lead.website && lead.status === 'new') {
            try { await scrapeWebsite(lead.id) } catch { /* proceed */ }
          }
          try {
            await generateEmail(lead.id)
            const refreshed = await pool.query('SELECT generated_subject, generated_body FROM leads WHERE id = $1', [lead.id])
            subject = refreshed.rows[0]?.generated_subject
            bodyText = refreshed.rows[0]?.generated_body
          } catch (e) {
            failures.push(`"${lead.business_name}": pitch generation error (${e instanceof Error ? e.message : String(e)})`)
            continue
          }
        }

        if (!subject || !bodyText) {
          failures.push(`"${lead.business_name}": unable to create pitch`)
          continue
        }

        const sendResult = await sendSingleLead(lead.id)
        if (sendResult.sent) sentCount++
        else failures.push(`"${lead.business_name}": ${sendResult.rejected || 'Gmail send failed'}`)
      }

      return NextResponse.json({
        success: true,
        sentCount,
        skippedCount: skipped.length,
        failureCount: failures.length,
        skipped,
        failures,
        message: `Dispatched outreach to ${sentCount} lead${sentCount === 1 ? '' : 's'}.${
          skipped.length > 0 ? ` Skipped ${skipped.length} (no email or suppressed).` : ''
        }${failures.length > 0 ? ` ${failures.length} failed.` : ''}`,
      })
    }

    if (action === 'enrich_single') {
      if (!leadId) {
        return NextResponse.json({ success: false, error: 'leadId is required.' }, { status: 400 })
      }

      const result = await enrichLeadEmail(leadId)
      return NextResponse.json({
        success: true,
        result,
        message: result.email
          ? `Found email ${result.email} (${result.emailConfidence} confidence) via ${result.emailSource || 'website crawler'}.`
          : 'No verified email found on the website or public search sources.',
        emailFound: Boolean(result.email),
      })
    }

    if (action === 'run_lead_pipeline') {
      if (!leadId) {
        return NextResponse.json({ success: false, error: 'leadId is required.' }, { status: 400 })
      }

      const leadRes = await pool.query('SELECT id, website, email, status FROM leads WHERE id = $1', [leadId])
      if (leadRes.rows.length === 0) {
        return NextResponse.json({ success: false, error: 'Lead not found.' }, { status: 404 })
      }

      const lead = leadRes.rows[0]
      const steps: string[] = []

      // Step 1: Scrape & audit (if website exists)
      if (lead.website && lead.website.trim() !== '') {
        try {
          await scrapeWebsite(leadId)
          steps.push('Scraped & audited website')
        } catch (e) {
          steps.push(`Scrape failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else {
        steps.push('No website — skipped scrape/audit')
      }

      // Step 2: If no email, try enrichment
      const refreshed = await pool.query('SELECT email, website FROM leads WHERE id = $1', [leadId])
      const currentEmail = refreshed.rows[0]?.email
      if (!currentEmail) {
        // Try search engine sourcing
        const enrichRes = await pool.query(
          `SELECT l.id, l.business_name, l.address, l.website, l.place_id, l.status, n.city
           FROM leads l LEFT JOIN niches n ON n.id = l.niche_id WHERE l.id = $1`,
          [leadId]
        )
        const enrichLead = enrichRes.rows[0]
        let domain: string | null = null
        if (enrichLead?.website) {
          try {
            const formatted = /^https?:\/\//i.test(enrichLead.website) ? enrichLead.website : `https://${enrichLead.website}`
            domain = new URL(formatted).hostname.replace(/^www\./, '')
          } catch { /* ignore */ }
        }
        try {
          const found = await findEmailViaSearch(enrichLead.business_name, enrichLead.city || '', domain)
          if (found && !(await isSuppressedEmail(found.email))) {
            await pool.query(
              `UPDATE leads SET email = $1, email_source = $2, email_confidence = $3, email_source_url = $4, status = 'scraped' WHERE id = $5`,
              [found.email, found.source, found.confidence, found.sourceUrl || null, leadId]
            )
            steps.push(`Found email: ${found.email} (${found.confidence})`)
          } else {
            steps.push('Email search returned no results')
          }
        } catch (e) {
          steps.push(`Email search failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else {
        steps.push(`Email already present: ${currentEmail}`)
      }

      // Step 3: Generate pitch if email now exists
      const afterEnrich = await pool.query('SELECT email FROM leads WHERE id = $1', [leadId])
      if (afterEnrich.rows[0]?.email) {
        try {
          const ok = await generateEmail(leadId)
          steps.push(ok ? 'Generated personalized pitch' : 'Pitch generation returned false')
        } catch (e) {
          steps.push(`Pitch generation failed: ${e instanceof Error ? e.message : String(e)}`)
        }
      } else {
        steps.push('No email available — skipped pitch generation')
      }

      const updatedLead = await pool.query('SELECT * FROM leads WHERE id = $1', [leadId])
      return NextResponse.json({
        success: true,
        lead: updatedLead.rows[0],
        steps,
        message: `Pipeline complete. Steps: ${steps.join(' → ')}`,
      })
    }

    return NextResponse.json({ success: false, error: 'Unknown action.' }, { status: 400 })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
