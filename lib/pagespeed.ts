import { PAGESPEED_API_URL, PAGESPEED_TIMEOUT_MS } from './constants'

export interface PageSpeedMetrics {
  performanceScore: number // 0 - 100
  largestContentfulPaint?: string // e.g. "4.8 s"
  speedIndex?: string // e.g. "5.2 s"
  totalBlockingTime?: string // e.g. "450 ms"
  timeToInteractive?: string // e.g. "6.1 s"
  cumulativeLayoutShift?: string // e.g. "0.25"
  observedAt: string
}

/**
 * Fetches real Google Lighthouse mobile performance metrics for a URL via PageSpeed Insights API.
 * Free, non-billing, with 25,000 queries/day.
 * Fails gracefully and returns null on timeout or network error so lead auditing is never blocked.
 */
export async function fetchPageSpeedMetrics(
  targetUrl: string,
  timeoutMs = PAGESPEED_TIMEOUT_MS
): Promise<PageSpeedMetrics | null> {
  const apiKey =
    process.env.PAGESPEED_API_KEY ||
    process.env.GOOGLE_PLACES_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    ''

  const params = new URLSearchParams({
    url: targetUrl,
    strategy: 'mobile',
    category: 'PERFORMANCE',
  })

  if (apiKey) {
    params.set('key', apiKey)
  }

  const endpoint = `${PAGESPEED_API_URL}?${params.toString()}`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })

    if (!res.ok) {
      // 429 rate limit or invalid URL or unreachable
      return null
    }

    const data = await res.json()
    const lighthouse = data?.lighthouseResult
    if (!lighthouse) return null

    const perfCategory = lighthouse.categories?.performance
    const rawScore = typeof perfCategory?.score === 'number' ? Math.round(perfCategory.score * 100) : null
    if (rawScore === null) return null

    const audits = lighthouse.audits || {}

    const lcp = audits['largest-contentful-paint']?.displayValue || undefined
    const speedIndex = audits['speed-index']?.displayValue || undefined
    const tbt = audits['total-blocking-time']?.displayValue || undefined
    const tti = audits['interactive']?.displayValue || undefined
    const cls = audits['cumulative-layout-shift']?.displayValue || undefined

    return {
      performanceScore: rawScore,
      largestContentfulPaint: lcp,
      speedIndex,
      totalBlockingTime: tbt,
      timeToInteractive: tti,
      cumulativeLayoutShift: cls,
      observedAt: new Date().toISOString(),
    }
  } catch {
    // Graceful degradation: return null if PageSpeed is unreachable or timed out
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}
