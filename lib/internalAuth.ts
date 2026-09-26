import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const INTERNAL_SESSION_COOKIE = 'coldstart_internal_session'

function configuredToken(): string | null {
  const token = process.env.APP_ACCESS_TOKEN || process.env.CRON_SECRET
  return token && token.trim() ? token.trim() : null
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let result = 0
  for (let index = 0; index < left.length; index++) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return result === 0
}

export function isValidAccessToken(token: string | null | undefined): boolean {
  const expected = configuredToken()
  return Boolean(expected && token && safeEqual(token.trim(), expected))
}

export function isInternalRequestAuthorized(request: Request): boolean {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '')
  if (isValidAccessToken(bearer)) return true

  const cookieHeader = request.headers.get('cookie') || ''
  const cookie = cookieHeader
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${INTERNAL_SESSION_COOKIE}=`))
  return isValidAccessToken(cookie?.slice(INTERNAL_SESSION_COOKIE.length + 1))
}

export function requireInternalAuth(request: Request): NextResponse | null {
  if (!configuredToken()) {
    return NextResponse.json(
      { success: false, error: 'APP_ACCESS_TOKEN is not configured.' },
      { status: 503 }
    )
  }

  if (!isInternalRequestAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 })
  }

  return null
}

export function requireInternalWriteAuth(request: Request): NextResponse | null {
  const authError = requireInternalAuth(request)
  if (authError) return authError

  const origin = request.headers.get('origin')
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ success: false, error: 'Invalid request origin.' }, { status: 403 })
  }

  return null
}

export async function hasInternalSession(): Promise<boolean> {
  const cookieStore = await cookies()
  return isValidAccessToken(cookieStore.get(INTERNAL_SESSION_COOKIE)?.value)
}

export function setInternalSession(response: NextResponse): void {
  const token = configuredToken()
  if (!token) return

  response.cookies.set({
    name: INTERNAL_SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export function clearInternalSession(response: NextResponse): void {
  response.cookies.set({
    name: INTERNAL_SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
}
