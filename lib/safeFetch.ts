/**
 * URL checks and redirect handling shared by the lead website crawlers.
 * Each redirect target is validated before the next request is made.
 */
export function isSafeUrl(targetUrl: string): boolean {
  try {
    const formatted = /^https?:\/\//i.test(targetUrl) ? targetUrl : `https://${targetUrl}`
    const parsed = new URL(formatted)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

    const host = parsed.hostname.toLowerCase()
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.test') ||
      host.endsWith('.example')
    ) return false

    if (
      /^127\./.test(host) ||
      /^0\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host)
    ) return false

    const ipv6Host = host.replace(/^\[|\]$/g, '')
    if (
      ipv6Host === '::' ||
      ipv6Host === '::1' ||
      ipv6Host.startsWith('fc') ||
      ipv6Host.startsWith('fd') ||
      /^fe[89ab]/.test(ipv6Host) ||
      ipv6Host.startsWith('::ffff:')
    ) return false

    return true
  } catch {
    return false
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_SAFE_REDIRECTS = 5

export async function fetchWithSafeRedirects(
  targetUrl: string,
  init: RequestInit = {}
): Promise<Response> {
  let currentUrl = targetUrl

  for (let redirects = 0; ; redirects++) {
    if (!isSafeUrl(currentUrl)) {
      throw new Error(`Unsafe target or redirect URL rejected by SSRF guard: ${currentUrl}`)
    }

    const response = await fetch(currentUrl, { ...init, redirect: 'manual' })
    if (!REDIRECT_STATUSES.has(response.status)) return response

    const location = response.headers.get('location')
    if (!location) return response
    if (redirects >= MAX_SAFE_REDIRECTS) {
      await response.body?.cancel().catch(() => {})
      throw new Error(`Too many redirects while fetching ${targetUrl}`)
    }

    let nextUrl: string
    try {
      nextUrl = new URL(location, currentUrl).toString()
    } catch {
      await response.body?.cancel().catch(() => {})
      throw new Error(`Invalid redirect destination while fetching ${targetUrl}`)
    }

    await response.body?.cancel().catch(() => {})
    if (!isSafeUrl(nextUrl)) {
      throw new Error(`Unsafe redirect destination rejected by SSRF guard: ${nextUrl}`)
    }
    currentUrl = nextUrl
  }
}
