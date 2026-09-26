import { NextResponse } from 'next/server'
import { isValidAccessToken, setInternalSession, clearInternalSession } from '@/lib/internalAuth'

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const response = NextResponse.json({ success: isValidAccessToken(body.token) })

  if (!isValidAccessToken(body.token)) {
    return NextResponse.json({ success: false, error: 'Invalid access token.' }, { status: 401 })
  }

  setInternalSession(response)
  return response
}

export async function DELETE() {
  const response = NextResponse.json({ success: true })
  clearInternalSession(response)
  return response
}
