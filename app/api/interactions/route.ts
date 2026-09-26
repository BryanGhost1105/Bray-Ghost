import { NextResponse } from 'next/server'
import { pool, ensureSchema } from '@/lib/db'
import { requireInternalWriteAuth } from '@/lib/internalAuth'

export const dynamic = 'force-dynamic'

const CHANNELS = new Set(['email', 'whatsapp', 'phone', 'in_person', 'linkedin', 'other'])
const OUTCOMES = new Set([
  'attempted',
  'permission_granted',
  'conversation',
  'audit_walkthrough',
  'proposal_sent',
  'paid_pilot',
  'not_fit',
  'no_response',
  'unsubscribe',
  'other',
])

export async function POST(request: Request) {
  const authError = requireInternalWriteAuth(request)
  if (authError) return authError
  await ensureSchema()

  try {
    const body = await request.json().catch(() => ({}))
    const leadId = typeof body.leadId === 'string' ? body.leadId : ''
    const channel = typeof body.channel === 'string' ? body.channel : ''
    const outcome = typeof body.outcome === 'string' ? body.outcome : ''
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 4000) : null
    const occurredAt = typeof body.occurredAt === 'string' && body.occurredAt.trim()
      ? body.occurredAt
      : null
    const nextActionAt = typeof body.nextActionAt === 'string' && body.nextActionAt.trim()
      ? body.nextActionAt
      : null

    if (!leadId || !CHANNELS.has(channel) || !OUTCOMES.has(outcome)) {
      return NextResponse.json({ success: false, error: 'leadId, channel, and a valid outcome are required.' }, { status: 400 })
    }

    const lead = await pool.query('SELECT id FROM leads WHERE id = $1', [leadId])
    if (!lead.rows[0]) {
      return NextResponse.json({ success: false, error: 'Lead not found.' }, { status: 404 })
    }

    const result = await pool.query(
      `INSERT INTO lead_interactions (lead_id, channel, outcome, note, occurred_at, next_action_at)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, NOW()), $6::timestamptz)
       RETURNING *`,
      [leadId, channel, outcome, note || null, occurredAt, nextActionAt]
    )

    if (outcome === 'unsubscribe') {
      await pool.query(
        `UPDATE leads SET status = 'unsubscribed', unsubscribed_at = COALESCE(unsubscribed_at, NOW()),
         initial_approval_status = 'pending', followup_approval_status = 'pending'
         WHERE id = $1`,
        [leadId]
      )
    }

    return NextResponse.json({ success: true, interaction: result.rows[0] })
  } catch (error: unknown) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Failed to record interaction.' }, { status: 500 })
  }
}
