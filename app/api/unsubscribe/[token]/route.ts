import { NextResponse } from 'next/server'
import { pool, ensureSchema } from '@/lib/db'

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  await ensureSchema()

  const leadResult = await pool.query(
    `UPDATE leads
     SET status = 'unsubscribed', unsubscribed_at = NOW(), next_attempt_at = NULL,
         send_claimed_at = NULL, followup_claimed_at = NULL
     WHERE unsubscribe_token = $1
     RETURNING email`,
    [token]
  )

  const email = leadResult.rows[0]?.email
  if (email) {
    await pool.query(
      `INSERT INTO suppressed_emails (email, reason) VALUES (lower($1), 'unsubscribe')
       ON CONFLICT (email) DO UPDATE SET reason = 'unsubscribe'`,
      [email]
    )
  }

  return new NextResponse(
    '<!doctype html><html><body style="font-family: sans-serif; padding: 3rem"><h1>You are unsubscribed</h1><p>You will not receive further outreach from this address.</p></body></html>',
    { headers: { 'content-type': 'text/html; charset=utf-8' } }
  )
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  return GET(request, context)
}
