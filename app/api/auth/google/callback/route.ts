import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { pool } from '@/lib/db'
import { requireInternalAuth } from '@/lib/internalAuth'
import { encryptSecret } from '@/lib/secret'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authError = requireInternalAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  const origin = new URL(request.url).origin

  if (error) {
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(error)}`)
  }

  if (!code) {
    return NextResponse.redirect(`${origin}/?auth_error=no_code_provided`)
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || `${origin}/api/auth/google/callback`

  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${origin}/?auth_error=missing_credentials`)
  }

  try {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)
    const { tokens } = await oauth2Client.getToken(code)
    oauth2Client.setCredentials(tokens)

    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client })
    const userInfo = await oauth2.userinfo.get()
    const userEmail = userInfo.data.email || ''

    // Ensure settings table has columns for OAuth storage
    await pool.query(`
      ALTER TABLE settings 
      ADD COLUMN IF NOT EXISTS gmail_user text,
      ADD COLUMN IF NOT EXISTS gmail_refresh_token text;
    `)

    if (tokens.refresh_token) {
      await pool.query(
        `UPDATE settings SET gmail_user = $1, gmail_refresh_token = $2 WHERE id = 1`,
        [userEmail, encryptSecret(tokens.refresh_token)]
      )
    } else if (userEmail) {
      await pool.query(
        `UPDATE settings SET gmail_user = $1 WHERE id = 1`,
        [userEmail]
      )
    }

    return NextResponse.redirect(
      `${origin}/?auth=gmail_connected&email=${encodeURIComponent(userEmail)}`
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.redirect(`${origin}/?auth_error=${encodeURIComponent(message)}`)
  }
}
