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

    if (action === 'log_reply') {
      const { leadId } = body
      let replyRecorded = false
      if (leadId) {
        const replyResult = await pool.query(
          `UPDATE leads SET replied_at = COALESCE(replied_at, NOW()) WHERE id = $1`,
          [leadId]
        )
        replyRecorded = (replyResult.rowCount || 0) > 0
      }
      if (replyRecorded) {
        await pool.query(`UPDATE settings SET replies_count = COALESCE(replies_count, 0) + 1 WHERE id = 1`)
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'toggle_lead_reply') {
      const { leadId, replied } = body
      if (!leadId) {
        return NextResponse.json({ error: 'leadId is required' }, { status: 400 })
      }
      if (replied) {
        await pool.query('UPDATE leads SET replied_at = NOW() WHERE id = $1', [leadId])
      } else {
        await pool.query('UPDATE leads SET replied_at = NULL WHERE id = $1', [leadId])
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
      const { business_name, website, email, city } = body
      if (!business_name || !business_name.trim()) {
        return NextResponse.json({ error: 'Business name is required' }, { status: 400 })
      }
      if (!email || !email.trim()) {
        return NextResponse.json({ error: 'Email is required to send outreach' }, { status: 400 })
      }

      const trimmedName = business_name.trim()
      const trimmedEmail = email.trim().toLowerCase()
      if (!isValidBusinessEmail(trimmedEmail)) {
        return NextResponse.json({ error: 'Enter a valid business email address.' }, { status: 400 })
      }
      const trimmedWebsite = website?.trim() || null
      const trimmedCity = city?.trim() || null

      // Check if this email is suppressed (bounced/complained before)
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

      // Check for duplicate email in existing leads
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

      const hasWebsite = Boolean(trimmedWebsite)
      const status = hasWebsite ? 'new' : 'no_website'

      await pool.query(
        `INSERT INTO leads (business_name, address, website, email, status, seo_score)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [trimmedName, trimmedCity, trimmedWebsite, trimmedEmail, status, 20]
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
