import * as cheerio from 'cheerio'
import dns from 'dns'
import { pool } from './db'
import { isSafeUrl } from './scraper'
import {
  parseAllValidEmails,
  isValidBusinessEmail,
  classifyEmailType,
  scoreEmailForOutreach,
  type DiscoveredEmail,
  type EmailConfidence,
  type EmailType,
} from './emailQuality'
import { isSuppressedEmail } from './suppression'
import { callDeepSeekJson } from './ai'
import { findEmailViaSearch } from './emailfinder'

const dnsResolveMx = dns.promises.resolveMx

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const TIMEOUT_MS = 8000
const MAX_PAGES_PER_DOMAIN = 6

// Potential contact page sub-paths to test
const HIGH_PRIORITY_CONTACT_PATHS = [
  '/contact',
  '/contact-us',
  '/contactus',
  '/about',
  '/about-us',
  '/our-team',
  '/team',
  '/quote',
  '/get-a-quote',
  '/free-estimate',
  '/estimate',
  '/reach-us',
  '/privacy-policy',
  '/terms-of-service',
]

/**
 * Cloudflare Email Protection XOR Decoder
 */
export function decodeCloudflareEmail(encodedString: string): string {
  try {
    let email = ''
    const r = parseInt(encodedString.substring(0, 2), 16)
    for (let n = 2; n < encodedString.length; n += 2) {
      email += String.fromCharCode(parseInt(encodedString.substring(n, n + 2), 16) ^ r)
    }
    return email
  } catch {
    return ''
  }
}

/**
 * Decode HTML entities like &#64;, &#x40;, &commat;
 */
export function decodeHtmlEntities(str: string): string {
  if (!str) return ''
  return str
    .replace(/&#64;/gi, '@')
    .replace(/&#x40;/gi, '@')
    .replace(/&commat;/gi, '@')
    .replace(/&#46;/gi, '.')
    .replace(/&#x2e;/gi, '.')
    .replace(/%40/gi, '@')
}

/**
 * Check if a domain has valid DNS MX records (accepts incoming emails)
 */
export async function checkDomainMx(domain: string): Promise<boolean> {
  try {
    const cleanDomain = domain.toLowerCase().replace(/^www\./, '').trim()
    const mxRecords = await dnsResolveMx(cleanDomain)
    return Array.isArray(mxRecords) && mxRecords.length > 0
  } catch {
    return false
  }
}

/**
 * Normalize and clean web URLs
 */
export function normalizeWebsiteUrl(url: string): string {
  let clean = url.trim()
  if (!/^https?:\/\//i.test(clean)) {
    clean = 'https://' + clean
  }
  return clean.replace(/\/+$/, '')
}

/**
 * Safe fetch HTML with headers & timeout
 */
async function fetchHtmlSafe(url: string, timeoutMs = TIMEOUT_MS): Promise<string | null> {
  if (!isSafeUrl(url)) {
    return null
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    })

    if (!res.ok) return null

    const contentType = res.headers.get('content-type') || ''
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return null
    }

    return await res.text()
  } catch {
    return null
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Extract all contact candidate links from a Cheerio instance
 */
function extractInternalContactLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html)
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    return []
  }

  const links = new Set<string>()
  const baseHost = base.hostname.toLowerCase().replace(/^www\./, '')

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim()
    if (!href) return

    if (
      href.startsWith('mailto:') ||
      href.startsWith('tel:') ||
      href.startsWith('javascript:') ||
      href.startsWith('#')
    ) {
      return
    }

    try {
      const resolved = new URL(href, base)
      const linkHost = resolved.hostname.toLowerCase().replace(/^www\./, '')

      if (linkHost !== baseHost) return

      if (/\.(pdf|zip|png|jpg|jpeg|gif|svg|webp|css|js|mp4)$/i.test(resolved.pathname)) {
        return
      }

      const pathname = resolved.pathname.toLowerCase()
      const text = $(el).text().toLowerCase()

      const isContactLink =
        pathname.includes('contact') ||
        pathname.includes('about') ||
        pathname.includes('team') ||
        pathname.includes('staff') ||
        pathname.includes('quote') ||
        pathname.includes('estimate') ||
        pathname.includes('help') ||
        pathname.includes('support') ||
        text.includes('contact') ||
        text.includes('about us') ||
        text.includes('our team') ||
        text.includes('reach out') ||
        text.includes('get a quote')

      if (isContactLink) {
        const cleanUrl = resolved.origin + resolved.pathname.replace(/\/$/, '')
        if (cleanUrl !== baseUrl.replace(/\/$/, '')) {
          links.add(cleanUrl)
        }
      }
    } catch {
      // ignore parse error
    }
  })

  return Array.from(links).slice(0, MAX_PAGES_PER_DOMAIN)
}

/**
 * Deeply parse all types of emails from HTML (Cloudflare, mailto, JSON-LD, text, scripts)
 */
export function extractEmailsFromHtml(
  html: string,
  siteUrl: string,
  sourceLabel: string
): DiscoveredEmail[] {
  if (!html) return []

  const decodedHtml = decodeHtmlEntities(html)
  const $ = cheerio.load(decodedHtml)
  const emails: DiscoveredEmail[] = []
  const seen = new Set<string>()

  function addEmail(raw: string, typeHint?: string, confidenceHint?: EmailConfidence, sourceDetail?: string) {
    if (!raw) return
    const clean = raw.trim().toLowerCase().replace(/[.,;:)\]'">]+$/, '')
    if (isValidBusinessEmail(clean) && !seen.has(clean)) {
      seen.add(clean)
      const emailType = classifyEmailType(clean)
      emails.push({
        email: clean,
        type: emailType,
        confidence: confidenceHint || 'HIGH',
        source: sourceDetail || sourceLabel,
        sourceUrl: siteUrl,
      })
    }
  }

  // 1. Mailto links
  $('a[href*="mailto:"]').each((_, el) => {
    const href = $(el).attr('href')
    if (href) {
      const match = href.match(/mailto:([^?&]+)/i)
      if (match && match[1]) {
        const mail = decodeURIComponent(decodeHtmlEntities(match[1])).trim()
        addEmail(mail, undefined, 'HIGH', `${sourceLabel} (mailto)`)
      }
    }
  })

  // 2. Cloudflare email protection tags
  $('[data-cfemail]').each((_, el) => {
    const enc = $(el).attr('data-cfemail')
    if (enc) {
      const decoded = decodeCloudflareEmail(enc)
      if (decoded) {
        addEmail(decoded, undefined, 'HIGH', `${sourceLabel} (cloudflare-cfemail)`)
      }
    }
  })

  // 3. JSON-LD Schema.org metadata
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const content = $(el).text()
      const matches = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
      for (const m of matches) {
        addEmail(m, undefined, 'HIGH', `${sourceLabel} (json-ld schema)`)
      }
    } catch {
      // ignore
    }
  })

  // 4. Meta tags (e.g. meta[name="email"], meta[property="business:contact_data:email"])
  $('meta').each((_, el) => {
    const content = $(el).attr('content')
    if (content && content.includes('@')) {
      const matches = content.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || []
      for (const m of matches) {
        addEmail(m, undefined, 'HIGH', `${sourceLabel} (meta tag)`)
      }
    }
  })

  // 5. Raw body and inline scripts text extraction
  const standardEmails = parseAllValidEmails(decodedHtml, {
    siteUrl,
    source: sourceLabel,
    defaultConfidence: 'HIGH',
  })
  for (const item of standardEmails) {
    addEmail(item.email, item.type, item.confidence, item.source)
  }

  return emails
}

/**
 * Perform Search-based Email Discovery via search engine fallback
 */
async function searchEmailsViaEngines(
  businessName: string,
  city: string,
  domain?: string | null
): Promise<DiscoveredEmail[]> {
  const queries = [
    domain ? `site:${domain} email OR contact` : null,
    `"${businessName}" "${city}" email contact`,
    `"${businessName}" contact "@"`,
  ].filter(Boolean) as string[]

  const results: DiscoveredEmail[] = []
  const seen = new Set<string>()

  for (const q of queries) {
    try {
      // Search via DuckDuckGo HTML endpoint
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 6000)
      const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      })
      clearTimeout(timeoutId)

      if (res.ok) {
        const text = await res.text()
        const parsed = parseAllValidEmails(text, {
          source: 'search_engine_snippet',
          siteUrl: domain ? `https://${domain}` : undefined,
          defaultConfidence: 'MEDIUM',
        })
        for (const item of parsed) {
          if (!seen.has(item.email)) {
            seen.add(item.email)
            results.push(item)
          }
        }
      }
    } catch {
      // DuckDuckGo search attempt error
    }

    if (results.length > 0) break
  }

  return results
}

/**
 * Intelligent AI Contact Extractor using Gemini Flash
 * Used when page text exists but complex obfuscation or multiple names need parsing
 */
async function extractEmailWithAi(
  businessName: string,
  pageContent: string,
  domain?: string | null
): Promise<DiscoveredEmail | null> {
  if (!pageContent || pageContent.length < 50) return null

  try {
    const systemPrompt = `You are a specialized business contact intelligence extractor. Return JSON with the extracted contact email:
{
  "found": true or false,
  "email": "string or null",
  "type": "owner" | "sales" | "general" | "support" | "other",
  "confidence": "HIGH" | "MEDIUM" | "LOW"
}`

    const userMessage = `Analyze website text for "${businessName}" (Domain: ${domain || 'N/A'}).
Extract any genuine business contact email address.

WEBSITE TEXT:
${pageContent.slice(0, 3000)}`

    const parsed = await callDeepSeekJson(systemPrompt, userMessage, (val: unknown) => {
      if (typeof val === 'object' && val !== null) {
        return val as { found?: boolean; email?: string; type?: string; confidence?: string }
      }
      return null
    })

    if (parsed?.found && parsed.email && isValidBusinessEmail(parsed.email)) {
      const emailType: EmailType = ['owner', 'sales', 'support', 'general', 'management', 'other'].includes(parsed.type || '')
        ? (parsed.type as EmailType)
        : 'general'
      const confidence: EmailConfidence = ['HIGH', 'MEDIUM', 'LOW'].includes(parsed.confidence || '')
        ? (parsed.confidence as EmailConfidence)
        : 'HIGH'
      return {
        email: parsed.email.toLowerCase().trim(),
        type: emailType,
        confidence,
        source: 'ai_extracted',
        sourceUrl: domain ? `https://${domain}` : undefined,
      }
    }
  } catch {
    // AI extraction fallback
  }

  return null
}

export interface EnrichmentResult {
  leadId: string
  businessName: string
  website: string | null
  email: string | null
  emailConfidence: string | null
  emailSource: string | null
  emailSourceUrl: string | null
  emailType: string | null
  contactsFound: DiscoveredEmail[]
  status: string
  details: string
}

/**
 * Comprehensive Multi-Engine Email Enrichment for a single Lead
 */
export async function enrichLeadEmail(leadId: string): Promise<EnrichmentResult> {
  const leadRes = await pool.query(
    `SELECT l.id, l.business_name, l.website, l.address, l.email, l.status, n.city
     FROM leads l
     LEFT JOIN niches n ON n.id = l.niche_id
     WHERE l.id = $1`,
    [leadId]
  )

  if (leadRes.rows.length === 0) {
    throw new Error(`Lead ${leadId} not found.`)
  }

  const lead = leadRes.rows[0]
  const businessName = lead.business_name || 'Business'
  const city = lead.city || 'US'
  const website = lead.website ? normalizeWebsiteUrl(lead.website) : null
  let domain: string | null = null

  if (website) {
    try {
      domain = new URL(website).hostname.toLowerCase().replace(/^www\./, '')
    } catch {
      domain = null
    }
  }

  const discoveredContacts: DiscoveredEmail[] = []
  const seenEmails = new Set<string>()

  function collect(emails: DiscoveredEmail[]) {
    for (const e of emails) {
      if (e.email && !seenEmails.has(e.email)) {
        seenEmails.add(e.email)
        discoveredContacts.push(e)
      }
    }
  }

  let fullPageTextSummary = ''

  // === STEP 1: Deep Website Scraping ===
  if (website && domain) {
    try {
      const homeHtml = await fetchHtmlSafe(website)
      if (homeHtml) {
        // 1a. Extract from Homepage
        const homeEmails = extractEmailsFromHtml(homeHtml, website, 'website_homepage')
        collect(homeEmails)

        const $ = cheerio.load(homeHtml)
        $('script, style, noscript, svg').remove()
        fullPageTextSummary += $('body').text().replace(/\s+/g, ' ').trim().slice(0, 1500) + ' '

        // 1b. Crawl Discovered Internal Contact Pages
        const internalLinks = extractInternalContactLinks(homeHtml, website)
        
        // Also test high priority contact paths if not already in internal links
        const websiteOrigin = new URL(website).origin
        const directContactLinks: string[] = []
        for (const testPath of HIGH_PRIORITY_CONTACT_PATHS) {
          const directUrl = `${websiteOrigin}${testPath}`
          directContactLinks.push(directUrl)
        }

        const contactLinks = Array.from(new Set([...directContactLinks, ...internalLinks])).slice(0, MAX_PAGES_PER_DOMAIN)
        for (const subLink of contactLinks) {
          const subHtml = await fetchHtmlSafe(subLink, 5000)
          if (subHtml) {
            const subEmails = extractEmailsFromHtml(subHtml, subLink, 'website_contact')
            collect(subEmails)

            const $sub = cheerio.load(subHtml)
            $sub('script, style, noscript, svg').remove()
            fullPageTextSummary += $sub('body').text().replace(/\s+/g, ' ').trim().slice(0, 800) + ' '
          }
        }
      }
    } catch (err) {
      console.warn(`Website scraping notice for ${businessName}:`, err)
    }
  }

  // === STEP 2: AI Contact Extractor if text found ===
  if (discoveredContacts.length === 0 && fullPageTextSummary.length > 50) {
    const aiEmail = await extractEmailWithAi(businessName, fullPageTextSummary, domain)
    if (aiEmail) {
      collect([aiEmail])
    }
  }

  // === STEP 3: Multi-Engine Search Scraper ===
  if (discoveredContacts.length === 0) {
    try {
      const searchEmails = await searchEmailsViaEngines(businessName, city, domain)
      collect(searchEmails)

      // The engine HTML often omits the actual email while exposing a useful
      // contact-page result. Fetch and verify those result pages as a second
      // pass, including the no-website case handled by the shared finder.
      if (discoveredContacts.length === 0) {
        const verifiedSearchEmail = await findEmailViaSearch(businessName, city, domain)
        if (verifiedSearchEmail) collect([verifiedSearchEmail])
      }
    } catch (err) {
      console.warn(`Search scraper notice for ${businessName}:`, err)
    }
  }

  // DNS MX records only prove that a domain can receive mail. They do not
  // prove that a guessed mailbox exists, so never synthesize addresses.

  // === STEP 4: Suppression Check & Best Selection ===
  const cleanValidContacts: DiscoveredEmail[] = []
  for (const contact of discoveredContacts) {
    if (!(await isSuppressedEmail(contact.email))) {
      cleanValidContacts.push(contact)
    }
  }

  // Persist all found contacts to lead_contacts table
  for (const contact of cleanValidContacts) {
    await pool.query(
      `INSERT INTO lead_contacts (lead_id, email, email_type, source, confidence, source_url)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [leadId, contact.email, contact.type, contact.source, contact.confidence, contact.sourceUrl || website]
    )
  }

  let bestEmail: DiscoveredEmail | null = null
  if (cleanValidContacts.length > 0) {
    cleanValidContacts.sort(
      (a, b) => scoreEmailForOutreach(b, website) - scoreEmailForOutreach(a, website)
    )
    bestEmail = cleanValidContacts[0]
  }

  const finalEmail = bestEmail?.email || lead.email || null
  const finalConfidence = bestEmail?.confidence || (lead.email ? 'MEDIUM' : null)
  const finalSource = bestEmail?.source || (lead.email ? 'pre_existing' : null)
  const finalSourceUrl = bestEmail?.sourceUrl || null
  const finalType = bestEmail?.type || (lead.email ? 'general' : null)

  // Status progression: if email is found, move to 'scraped' so AI pitch generation can run
  let nextStatus = lead.status
  if (finalEmail) {
    if (lead.status === 'new' || lead.status === 'email_needed' || lead.status === 'no_website') {
      nextStatus = 'scraped'
    }
  } else {
    nextStatus = website ? 'email_needed' : 'no_website'
  }

  await pool.query(
    `UPDATE leads SET
       email = $1,
       email_confidence = $2,
       email_source = $3,
       email_source_url = $4,
       email_verification_status = CASE WHEN $2 = 'HIGH' AND $4 IS NOT NULL THEN 'source_verified' ELSE 'needs_review' END,
       email_verified_at = CASE WHEN $2 = 'HIGH' AND $4 IS NOT NULL THEN NOW() ELSE NULL END,
       email_verification_method = CASE WHEN $2 = 'HIGH' AND $4 IS NOT NULL THEN 'enrichment-source-check' ELSE NULL END,
       status = $5,
       email_last_attempt_at = NOW(),
       email_attempts = COALESCE(email_attempts, 0) + 1,
       next_attempt_at = CASE
         WHEN $1::text IS NOT NULL THEN NULL
         WHEN COALESCE(email_attempts, 0) + 1 >= 3 THEN NULL
         ELSE NOW() + INTERVAL '2 days'
       END
     WHERE id = $6`,
    [finalEmail, finalConfidence, finalSource, finalSourceUrl, nextStatus, leadId]
  )

  return {
    leadId,
    businessName,
    website,
    email: finalEmail,
    emailConfidence: finalConfidence,
    emailSource: finalSource,
    emailSourceUrl: finalSourceUrl,
    emailType: finalType,
    contactsFound: cleanValidContacts,
    status: nextStatus,
    details: finalEmail
      ? `Discovered email ${finalEmail} (${finalConfidence} confidence, source: ${finalSource})`
      : 'No verified email found yet across web, search, or domain MX.',
  }
}

/**
 * Bulk Enrich all leads in the database currently lacking emails
 */
export async function enrichAllPendingLeads(limit = 50): Promise<{
  totalProcessed: number
  enrichedCount: number
  results: EnrichmentResult[]
}> {
  const result = await pool.query(
    `SELECT id FROM leads
     WHERE email IS NULL
       AND status IN ('new', 'email_needed', 'no_website')
       AND COALESCE(email_attempts, 0) < 3
       AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
     ORDER BY opportunity_score DESC NULLS LAST, created_at DESC
     LIMIT $1`,
    [limit]
  )

  const leads = result.rows
  const enrichmentResults: EnrichmentResult[] = []
  let enrichedCount = 0

  // Process leads with batch concurrency
  const CONCURRENCY = 4
  for (let i = 0; i < leads.length; i += CONCURRENCY) {
    const batch = leads.slice(i, i + CONCURRENCY)
    const batchPromises = batch.map(async (row) => {
      try {
        const enriched = await enrichLeadEmail(row.id)
        if (enriched.email) enrichedCount++
        return enriched
      } catch (err) {
        console.error(`Enrichment failed for lead ${row.id}:`, err)
        return null
      }
    })

    const batchRes = await Promise.all(batchPromises)
    for (const r of batchRes) {
      if (r) enrichmentResults.push(r)
    }
  }

  return {
    totalProcessed: leads.length,
    enrichedCount,
    results: enrichmentResults,
  }
}
