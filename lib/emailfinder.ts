import { pool } from './db'
import * as cheerio from 'cheerio'
import { parseAllValidEmails, type DiscoveredEmail } from './emailQuality'
import { isSuppressedEmail } from './suppression'
import { fetchWithSafeRedirects, isSafeUrl } from './safeFetch'
import { MAX_EMAIL_SEARCH_RESULTS } from './constants'

const DDG_HTML_URL = 'https://html.duckduckgo.com/html/'
const BING_HTML_URL = 'https://www.bing.com/search'
const SEARCH_TIMEOUT_MS = 10000
const FETCH_TIMEOUT_MS = 8000
const REQUEST_DELAY_MS = 500
const SEARCH_ATTEMPTS = 2
const SEARCH_RETRY_DELAY_MS = 1500
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Aggregator/directory hosts rarely expose the business's own email publicly
const DIRECTORY_HOSTS = new Set([
  'yelp.com',
  'facebook.com',
  'instagram.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'yellowpages.com',
  'mapquest.com',
  'manta.com',
  'superpages.com',
  'chamberofcommerce.com',
  'bbb.org',
  'angieslist.com',
  'homeadvisor.com',
  'houzz.com',
  'thumbtack.com',
  'nextdoor.com',
  'foursquare.com',
  'tripadvisor.com',
  'zoominfo.com',
  'dnb.com',
])

function hostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase().replace(/^www\./, '') || ''
}

function isSameOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`)
}

function pageMentionsBusiness(html: string, businessName: string, city: string): boolean {
  const $ = cheerio.load(html)
  $('script, style, noscript, svg').remove()
  const text = $('body').text().toLowerCase().replace(/\s+/g, ' ')
  const businessTokens = businessName.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 3)
  const businessMatch = businessTokens.slice(0, 4).some((token) => text.includes(token))
  const cityName = city.split(',')[0]?.trim().toLowerCase()
  return businessMatch && (!cityName || text.includes(cityName))
}

interface SourcingLead {
  id: string
  business_name: string
  address: string | null
  website: string | null
  place_id: string | null
  status: string
  city: string
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchHtml(url: string, timeoutMs: number): Promise<string> {
  if (!isSafeUrl(url)) {
    throw new Error(`Unsafe target URL rejected by SSRF guard: ${url}`)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetchWithSafeRedirects(url, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    })
    if (!res.ok) {
      throw new Error(`Failed to fetch ${url}: status ${res.status}`)
    }
    return await res.text()
  } finally {
    clearTimeout(timeoutId)
  }
}

interface SearchResults {
  urls: string[]
  snippetEmails: DiscoveredEmail[]
}

async function ddgSearch(query: string): Promise<SearchResults> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${DDG_HTML_URL}?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: { 'User-Agent': USER_AGENT },
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok || res.status === 202 || res.status === 403) {
    throw new Error(`DuckDuckGo search failed with status ${res.status}`)
  }

  const html = await res.text()
  if (/unusual traffic|anomaly/i.test(html)) {
    throw new Error('DuckDuckGo served an anomaly/rate-limit page')
  }

  const $ = cheerio.load(html)

  const urls: string[] = []
  $('a.result__a').each((_, el) => {
    const href = $(el).attr('href')
    if (!href) return
    let target = href
    try {
      const parsed = new URL(href.startsWith('//') ? `https:${href}` : href, DDG_HTML_URL)
      const uddg = parsed.searchParams.get('uddg')
      if (uddg) target = uddg
    } catch {
      // fall back to raw href
    }
    urls.push(target)
  })

  const snippets: string[] = []
  $('.result__snippet').each((_, el) => {
    const text = $(el).text()
    if (text) snippets.push(text)
  })

  const snippetEmails = parseAllValidEmails(snippets.join(' '), {
    source: 'search_snippet',
    defaultConfidence: 'MEDIUM',
  })

  return {
    urls: Array.from(new Set(urls)).slice(0, MAX_EMAIL_SEARCH_RESULTS),
    snippetEmails,
  }
}

async function bingSearch(query: string): Promise<SearchResults> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(`${BING_HTML_URL}?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    throw new Error(`Bing search failed with status ${res.status}`)
  }

  const html = await res.text()
  if (/captcha|unusual traffic/i.test(html) && html.length < 20000) {
    throw new Error('Bing served a captcha/block page')
  }

  const $ = cheerio.load(html)

  const urls: string[] = []
  $('li.b_algo h2 a').each((_, el) => {
    const href = $(el).attr('href')
    if (href && href.startsWith('http')) urls.push(href)
  })

  const snippets: string[] = []
  $('li.b_algo .b_caption p, li.b_algo p').each((_, el) => {
    const text = $(el).text()
    if (text) snippets.push(text)
  })

  const snippetEmails = parseAllValidEmails(snippets.join(' '), {
    source: 'search_snippet',
    defaultConfidence: 'MEDIUM',
  })

  return {
    urls: Array.from(new Set(urls)).slice(0, MAX_EMAIL_SEARCH_RESULTS),
    snippetEmails,
  }
}

async function searchResultUrls(query: string): Promise<SearchResults> {
  let lastDdgError: string | null = null
  let ddgResults: SearchResults | null = null
  for (let attempt = 1; attempt <= SEARCH_ATTEMPTS; attempt++) {
    try {
      ddgResults = await ddgSearch(query)
      if (ddgResults.urls.length > 0 || ddgResults.snippetEmails.length > 0) break
    } catch (err) {
      lastDdgError = err instanceof Error ? err.message : String(err)
      if (attempt < SEARCH_ATTEMPTS) await sleep(SEARCH_RETRY_DELAY_MS)
    }
  }

  try {
    const bingResults = await bingSearch(query)
    return {
      urls: Array.from(new Set([...(ddgResults?.urls || []), ...bingResults.urls])).slice(0, MAX_EMAIL_SEARCH_RESULTS * 2),
      snippetEmails: [...(ddgResults?.snippetEmails || []), ...bingResults.snippetEmails],
    }
  } catch (err) {
    const bingError = err instanceof Error ? err.message : String(err)
    if (ddgResults) return ddgResults
    throw new Error(`Email search failed: ${lastDdgError}; Bing fallback: ${bingError}`)
  }
}

export async function findEmailViaSearch(
  businessName: string,
  city: string,
  websiteDomain?: string | null
): Promise<DiscoveredEmail | null> {
  const query = websiteDomain
    ? `site:${websiteDomain} email OR contact`
    : `"${businessName}" "${city}" contact email`

  const { urls, snippetEmails } = await searchResultUrls(query)
  if (websiteDomain && snippetEmails.length > 0) {
    const matchingSnippet = snippetEmails.find((email) => isSameOrSubdomain(emailDomain(email.email), websiteDomain))
    if (matchingSnippet) return matchingSnippet
  }

  for (const url of urls) {
    const host = hostname(url)
    if (DIRECTORY_HOSTS.has(host) || !isSafeUrl(url)) {
      continue
    }

    if (websiteDomain && !isSameOrSubdomain(host, websiteDomain)) continue

    try {
      const html = await fetchHtml(url, FETCH_TIMEOUT_MS)
      if (!websiteDomain && !pageMentionsBusiness(html, businessName, city)) continue
      const emails = parseAllValidEmails(html, {
        source: 'search_result_page',
        siteUrl: url,
        defaultConfidence: 'MEDIUM',
      })
      if (emails.length > 0) {
        return { ...emails[0], sourceUrl: url }
      }
    } catch (err) {
      console.warn(`Search result page fetch failed for "${businessName}" (${url}):`, err instanceof Error ? err.message : String(err))
    }
    await sleep(REQUEST_DELAY_MS)
  }

  return null
}

/**
 * Searches for emails for leads in 'no_website' or 'email_needed' status.
 * NEVER deletes leads or suppresses places when emails cannot be found.
 */
export async function sourceNoWebsiteEmails(
  max: number,
  isExhausted?: () => boolean
): Promise<{ sourced: number; pending: number; failures: string[] }> {
  const result = await pool.query(
    `SELECT l.id, l.business_name, l.address, l.website, l.place_id, l.status,
            COALESCE(n.city, l.address, '') AS city
     FROM leads l LEFT JOIN niches n ON n.id = l.niche_id
     WHERE (l.status = 'no_website' OR l.status = 'email_needed') AND l.email IS NULL
       AND COALESCE(l.email_attempts, 0) < 3
       AND (l.next_attempt_at IS NULL OR l.next_attempt_at <= NOW())
     ORDER BY l.opportunity_score DESC NULLS LAST, l.seo_score ASC NULLS LAST
     LIMIT $1`,
    [max]
  )

  let sourced = 0
  let pending = 0
  const failures: string[] = []

  for (const lead of result.rows as SourcingLead[]) {
    if (isExhausted?.()) break

    const businessName = lead.business_name
    const city = lead.city
    let domain: string | null = null

    if (lead.website) {
      try {
        const formatted = /^https?:\/\//i.test(lead.website) ? lead.website : `https://${lead.website}`
        domain = new URL(formatted).hostname.replace(/^www\./, '')
      } catch {
        // ignore
      }
    }

    let foundEmail: DiscoveredEmail | null = null
    let searchFailed = false

    try {
      foundEmail = await findEmailViaSearch(businessName, city, domain)

      if (foundEmail && (await isSuppressedEmail(foundEmail.email))) {
        foundEmail = null
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`Email search error for lead ${lead.id} (${businessName}):`, message)
      failures.push(`Lead ${lead.id} (${businessName}): ${message}`)
      searchFailed = true
    }

    if (searchFailed) {
      await pool.query(
        `UPDATE leads SET email_attempts = COALESCE(email_attempts, 0) + 1,
         email_last_attempt_at = NOW(),
         next_attempt_at = CASE WHEN COALESCE(email_attempts, 0) + 1 >= 3 THEN NULL ELSE NOW() + INTERVAL '2 days' END
         WHERE id = $1`,
        [lead.id]
      )
      continue
    }

    if (foundEmail) {
      // Record contact in lead_contacts
      await pool.query(
        `INSERT INTO lead_contacts (lead_id, email, email_type, source, confidence, source_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [lead.id, foundEmail.email, foundEmail.type, foundEmail.source, foundEmail.confidence, foundEmail.sourceUrl || null]
      )

      const fallbackContent = `Business Name: ${businessName}\nAddress: ${lead.address || 'Unknown Address'}\nCity: ${city}\nWebsite: ${lead.website || 'None'}\nEmail Source: Search Fallback (${foundEmail.email})`

      await pool.query(
        `UPDATE leads SET
           email = $1,
           email_source = $2,
           email_confidence = $3,
           email_source_url = $4,
           email_verification_status = CASE WHEN $3::text = 'HIGH' AND $4::text IS NOT NULL AND $2::text IS DISTINCT FROM 'ai_extracted' THEN 'source_verified' ELSE 'needs_review' END,
           email_verified_at = CASE WHEN $3::text = 'HIGH' AND $4::text IS NOT NULL AND $2::text IS DISTINCT FROM 'ai_extracted' THEN NOW() ELSE NULL END,
           email_verification_method = CASE WHEN $3::text = 'HIGH' AND $4::text IS NOT NULL AND $2::text IS DISTINCT FROM 'ai_extracted' THEN 'search-fallback-source-check' ELSE NULL END,
           scraped_content = COALESCE(scraped_content, $5),
           status = 'scraped'
         WHERE id = $6`,
        [foundEmail.email, foundEmail.source, foundEmail.confidence, foundEmail.sourceUrl || null, fallbackContent, lead.id]
      )
      sourced++
    } else {
      // Email not found: Keep lead as 'email_needed' (or 'no_website') - NEVER DELETE!
      const statusToSet = lead.website ? 'email_needed' : 'no_website'
      await pool.query(
        `UPDATE leads SET status = $1, email_attempts = COALESCE(email_attempts, 0) + 1,
         email_last_attempt_at = NOW(),
         next_attempt_at = CASE WHEN COALESCE(email_attempts, 0) + 1 >= 3 THEN NULL ELSE NOW() + INTERVAL '2 days' END
         WHERE id = $2`,
        [statusToSet, lead.id]
      )
      pending++
    }

    await sleep(REQUEST_DELAY_MS)
  }

  return { sourced, pending, failures }
}
