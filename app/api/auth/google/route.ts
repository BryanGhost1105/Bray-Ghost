import { NextResponse } from 'next/server'
import { google } from 'googleapis'
import { requireInternalAuth } from '@/lib/internalAuth'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const authError = requireInternalAuth(request)
  if (authError) return authError

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error:
          'GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing in environment variables. Please add them to .env.local.',
      },
      { status: 400 }
    )
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, redirectUri)

  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/userinfo.email',
  ]

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: scopes,
  })

  return NextResponse.redirect(url)
}
