import { NextResponse } from 'next/server'
import { pool, ensureSchema } from '@/lib/db'
import { MAX_DAILY_CAP } from '@/lib/constants'
import { requireInternalWriteAuth } from '@/lib/internalAuth'
import { isValidBusinessEmail } from '@/lib/emailQuality'

export async function POST(request: Request) {
  const authError = requireInternalWriteAuth(request)
  if (authError) return authError
  await ensureSchema()

  try {
    const body = await request.json()
    const { action } = body

    if (action === 'update_settings') {
      const { daily_cap, paused } = body
      const cap = parseInt(daily_cap, 10)
      if (isNaN(cap) || cap < 1) {
        return NextResponse.json({ error: 'Invalid daily cap' }, { status: 400 })
      }
      if (cap > MAX_DAILY_CAP) {
        return NextResponse.json({ error: `Daily cap cannot exceed the internal ${MAX_DAILY_CAP}/day safety ceiling` }, { status: 400 })
      }
      const isPaused = Boolean(paused)

      await pool.query(
        `insert into settings (id, daily_cap, paused) values (1, $1, $2)
         on conflict (id) do update set daily_cap = excluded.daily_cap, paused = excluded.paused`,
        [cap, isPaused]
      )

      return NextResponse.json({ success: true })
    }

    if (action === 'save_targeting') {
      const { industries, cities } = body as { industries: string[]; cities: string[] }

      if (!Array.isArray(industries) || !Array.isArray(cities) || industries.length < 1 || cities.length < 1) {
        return NextResponse.json(
          { error: 'You must select at least 1 industry and 1 city.' },
          { status: 400 }
        )
      }

      // 1. Get all existing niches
      const existingResult = await pool.query('select id, label, city, status, source from niches')
      const existingNiches = existingResult.rows

      // 2. For every pair of selected industry and city, ensure an active niche exists
      for (const industry of industries) {
        for (const city of cities) {
          const found = existingNiches.find(
            (n) => n.label.toLowerCase() === industry.toLowerCase() && n.city.toLowerCase() === city.toLowerCase()
          )

          if (found) {
            // Update to active if it was exhausted
            if (found.status !== 'active') {
              await pool.query('update niches set status = $1 where id = $2', ['active', found.id])
            }
          } else {
            // Insert new seed niche
            await pool.query(
              'insert into niches (label, city, status, source) values ($1, $2, $3, $4)',
              [industry, city, 'active', 'seed']
            )
          }
        }
      }

      // 3. For seed niches that are no longer in the selected combination grid, set status to 'exhausted' (or leave custom/ai ones alone)
      for (const n of existingNiches) {
        if (n.source === 'seed' || n.source === 'ai_suggested') {
          const inSelectedGrid = industries.some(
            (ind) => ind.toLowerCase() === n.label.toLowerCase()
          ) && cities.some(
            (cit) => cit.toLowerCase() === n.city.toLowerCase()
          )

          if (!inSelectedGrid && n.status === 'active') {
            await pool.query('update niches set status = $1 where id = $2', ['exhausted', n.id])
          }
        }
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'toggle_lead_reply') {
      const { leadId, replied } = body
      if (typeof leadId !== 'string' || !leadId || typeof replied !== 'boolean') {
        return NextResponse.json({ error: 'leadId and a boolean replied value are required' }, { status: 400 })
      }
      if (replied) {
        const result = await pool.query(
          `UPDATE leads
           SET replied_at = COALESCE(replied_at, NOW()),
               followup_approval_status = 'pending',
               followup_approved_at = NULL,
               followup_approved_by = NULL,
               followup_claimed_at = NULL,
               followup_next_attempt_at = NULL
           WHERE id = $1
           RETURNING id`,
          [leadId]
        )
        if (!result.rowCount) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      } else {
        const result = await pool.query('UPDATE leads SET replied_at = NULL WHERE id = $1 RETURNING id', [leadId])
        if (!result.rowCount) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'add_custom_niche') {
      const { label, city } = body
      if (!label || !city) {
        return NextResponse.json({ error: 'Label and city are required' }, { status: 400 })
      }

      const trimmedLabel = label.trim()
      const trimmedCity = city.trim()

      // Dedupe case-insensitively on (label, city). If a matching niche exists
      // but was exhausted, reactivate it instead of creating a duplicate row
      // that would double the Google Places spend on the same search pool.
      const existingResult = await pool.query(
        'SELECT id, status FROM niches WHERE lower(label) = lower($1) AND lower(city) = lower($2) LIMIT 1',
        [trimmedLabel, trimmedCity]
      )
      if (existingResult.rows.length > 0) {
        if (existingResult.rows[0].status !== 'active') {
          await pool.query('update niches set status = $1 where id = $2', ['active', existingResult.rows[0].id])
        }
        return NextResponse.json({ success: true, alreadyExists: true })
      }

      await pool.query(
        'insert into niches (label, city, status, source) values ($1, $2, $3, $4)',
        [trimmedLabel, trimmedCity, 'active', 'seed']
      )

      return NextResponse.json({ success: true })
    }

    if (action === 'add_lead') {
      const { business_name, website, email, city, source_url, opening_date, opening_source_url } = body
      if (typeof business_name !== 'string' || !business_name.trim()) {
        return NextResponse.json({ error: 'Business name is required' }, { status: 400 })
      }
      const validHttpUrl = (value: unknown): value is string => {
        if (typeof value !== 'string' || value.length > 2048) return false
        try {
          const parsed = new URL(value)
          return parsed.protocol === 'http:' || parsed.protocol === 'https:'
        } catch {
          return false
        }
      }

      const trimmedName = business_name.trim()
      const trimmedEmail = typeof email === 'string' ? email.trim().toLowerCase() : ''
      if (trimmedEmail && !isValidBusinessEmail(trimmedEmail)) {
        return NextResponse.json({ error: 'Enter a valid business email address.' }, { status: 400 })
      }
      const trimmedWebsite = typeof website === 'string' && website.trim() ? website.trim() : null
      const trimmedCity = typeof city === 'string' && city.trim() ? city.trim() : null
      const trimmedSourceUrl = typeof source_url === 'string' && source_url.trim() ? source_url.trim() : null
      const trimmedOpeningSourceUrl = typeof opening_source_url === 'string' && opening_source_url.trim() ? opening_source_url.trim() : null
      const trimmedOpeningDate = typeof opening_date === 'string' && opening_date.trim() ? opening_date.trim() : null

      if (trimmedSourceUrl && !validHttpUrl(trimmedSourceUrl)) {
        return NextResponse.json({ error: 'Source URL must be an HTTP or HTTPS URL.' }, { status: 400 })
      }
      if (trimmedOpeningSourceUrl && !validHttpUrl(trimmedOpeningSourceUrl)) {
        return NextResponse.json({ error: 'Opening evidence URL must be an HTTP or HTTPS URL.' }, { status: 400 })
      }
      if (trimmedOpeningDate) {
        const date = new Date(`${trimmedOpeningDate}T00:00:00.000Z`)
        if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedOpeningDate) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== trimmedOpeningDate) {
          return NextResponse.json({ error: 'Opening date must be a valid calendar date.' }, { status: 400 })
        }
        if (!trimmedOpeningSourceUrl) {
          return NextResponse.json({ error: 'Add the source URL that supports the opening date.' }, { status: 400 })
        }
      }

      // Check if this email is suppressed (bounced/complained before)
      if (trimmedEmail) {
        const suppressedCheck = await pool.query(
          'SELECT email FROM suppressed_emails WHERE email = $1',
          [trimmedEmail]
        )
        if (suppressedCheck.rows.length > 0) {
          return NextResponse.json(
            { error: 'This email address was previously suppressed (bounced or complained). Cannot add.' },
            { status: 400 }
          )
        }

        const dupeCheck = await pool.query(
          'SELECT id FROM leads WHERE lower(email) = $1 LIMIT 1',
          [trimmedEmail]
        )
        if (dupeCheck.rows.length > 0) {
          return NextResponse.json(
            { error: 'A lead with this email already exists.' },
            { status: 400 }
          )
        }
      }

      const hasWebsite = Boolean(trimmedWebsite)
      const status = !trimmedEmail ? 'email_needed' : hasWebsite ? 'new' : 'no_website'

      await pool.query(
        `INSERT INTO leads (business_name, address, website, email, status, seo_score, lead_source_url, opening_date, opening_source_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [trimmedName, trimmedCity, trimmedWebsite, trimmedEmail || null, status, 20, trimmedSourceUrl, trimmedOpeningDate, trimmedOpeningSourceUrl]
      )

      return NextResponse.json({ success: true, status })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error: unknown) {
    console.error('Settings API error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    )
  }
}
