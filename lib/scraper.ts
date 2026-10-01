import { pool } from './db'
import * as cheerio from 'cheerio'
import { auditWebsite, type AuditResult } from './audit'
import { fetchPageSpeedMetrics, type PageSpeedMetrics } from './pagespeed'
import {
  scoreEmailForOutreach,
  type DiscoveredEmail,
} from './emailQuality'
import { isSuppressedEmail } from './suppression'
import { SCRAPE_TIMEOUT_MS } from './constants'

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'

const MAX_INTERNAL_PAGES_TO_CRAWL = 4
const INTERNAL_PAGE_TIMEOUT_MS = 6000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Validates external URLs to prevent SSRF vulnerabilities (loopback, private ranges, metadata).
 */
export function isSafeUrl(targetUrl: string): boolean {
  try {
    const formatted = /^https?:\/\//i.test(targetUrl) ? targetUrl : `https://${targetUrl}`
    const parsed = new URL(formatted)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false
    }

    const host = parsed.hostname.toLowerCase()

    // Block localhost and standard test domains
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host.endsWith('.test') ||
      host.endsWith('.example')
    ) {
      return false
    }

    // Block IPv4 private/loopback/cloud metadata ranges
    if (
      /^127\./.test(host) ||
      /^0\./.test(host) ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
      /^169\.254\./.test(host)
    ) {
      return false
    }

    // Block IPv6 loopback and private
    if (host === '::1' || host === '[::1]' || host.startsWith('fc00:') || host.startsWith('fe80:')) {
      return false
    }

    return true
  } catch {
    return false
  }
}

function normalizeUrl(url: string): string {
  let formatted = url.trim()
  if (!/^https?:\/\//i.test(formatted)) {
    formatted = 'https://' + formatted
  }
  return formatted
}

async function fetchPageHtml(url: string, timeoutMs: number): Promise<string> {
  if (!isSafeUrl(url)) {
    throw new Error(`Unsafe target URL rejected by SSRF guard: ${url}`)
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} when fetching ${url}`)
    }

    return await res.text()
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Discovers internal contact/about/quote links from homepage HTML.
 */
function discoverContactLinks(html: string, baseUrl: string): string[] {
  const $ = cheerio.load(html)
  const baseObj = new URL(baseUrl)
  const seen = new Set<string>()
  const discovered: { url: string; score: number }[] = []

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href')?.trim()
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:') || href.startsWith('tel:')) {
      return
    }

    try {
      const resolved = new URL(href, baseUrl)
      // Must be same origin
      if (resolved.origin !== baseObj.origin) {
        return
      }

      const cleanUrl = resolved.origin + resolved.pathname
      if (cleanUrl === baseUrl || seen.has(cleanUrl)) {
        return
      }

      seen.add(cleanUrl)

      const pathLower = resolved.pathname.toLowerCase()
      const anchorText = $(el).text().toLowerCase()

      let score = 0
      if (pathLower.includes('contact') || anchorText.includes('contact')) score += 10
      if (pathLower.includes('get-in-touch') || anchorText.includes('get in touch')) score += 9
      if (pathLower.includes('about') || anchorText.includes('about')) score += 7
      if (pathLower.includes('team') || anchorText.includes('our team')) score += 6
      if (pathLower.includes('staff') || pathLower.includes('leadership')) score += 5
      if (pathLower.includes('location') || pathLower.includes('locations')) score += 4
      if (pathLower.includes('quote') || pathLower.includes('estimate')) score += 5
      if (pathLower.includes('support') || pathLower.includes('help')) score += 3

      if (score > 0) {
        discovered.push({ url: cleanUrl, score })
      }
    } catch {
      // url parse error
    }
  })

  discovered.sort((a, b) => b.score - a.score)
  return discovered.slice(0, MAX_INTERNAL_PAGES_TO_CRAWL).map((d) => d.url)
}

/**
 * Extracts phone numbers from text and tel: links.
 */
function extractPhoneNumbers(html: string): string[] {
  const $ = cheerio.load(html)
  const phones: string[] = []

  $('a[href^="tel:" i]').each((_, el) => {
    const href = $(el).attr('href')
    if (href) {
      const num = href.replace(/^tel:/i, '').trim()
      if (num) phones.push(num)
    }
  })

  const text = $('body').text()
  const phoneRegex = /(?:\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/g
  let match
  while ((match = phoneRegex.exec(text)) !== null) {
    phones.push(match[0].trim())
  }

  return Array.from(new Set(phones))
}

/**
 * Scrapes and audits a lead's website.
 * Runs 6-dimensional audit, Google PageSpeed lab metrics, contact discovery, email validation,
 * and updates lead intelligence without deleting leads if email is missing.
 */
export async function scrapeWebsite(leadId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT l.id, l.website, l.email, l.business_name, l.address, l.place_id, l.seo_score, l.seo_flags
     FROM leads l WHERE l.id = $1`,
    [leadId]
  )

  if (result.rows.length === 0) {
    return false
  }

  const lead = result.rows[0]
  const rawWebsite = lead.website
  const businessName = lead.business_name || 'Unknown Business'
  const address = lead.address || 'Unknown Address'

  if (!rawWebsite || rawWebsite.trim() === '') {
    // Route to no_website status so emailfinder can search
    await pool.query('UPDATE leads SET status = $1 WHERE id = $2', ['no_website', leadId])
    return false
  }

  const siteUrl = normalizeUrl(rawWebsite)

  try {
    // Kick off Google PageSpeed Insights query in background
    const pageSpeedPromise: Promise<PageSpeedMetrics | null> = fetchPageSpeedMetrics(siteUrl).catch(() => null)

    // Step 1: Fetch Homepage HTML
    const homepageHtml = await fetchPageHtml(siteUrl, SCRAPE_TIMEOUT_MS)

    // Extract Homepage text for AI context
    const $home = cheerio.load(homepageHtml)
    $home('script, style, noscript, nav, footer, svg').remove()
    const homeBodyText = $home('body').text().replace(/\s+/g, ' ').trim().slice(0, 2500)

    // Extract phones
    const phoneCandidates = extractPhoneNumbers(homepageHtml)
    const primaryPhone = phoneCandidates[0] || null

    // Step 2: Discover & Crawl Internal Contact Pages with Deep Extraction & Broken Link Tracking
    const { extractEmailsFromHtml, checkDomainMx } = await import('./emailScraperEngine')
    const internalLinks = discoverContactLinks(homepageHtml, siteUrl)
    const brokenContactLinks: string[] = []
    const discoveredEmails: DiscoveredEmail[] = extractEmailsFromHtml(
      homepageHtml,
      siteUrl,
      'website_homepage'
    )

    for (const link of internalLinks) {
      try {
        await sleep(200)
        const subHtml = await fetchPageHtml(link, INTERNAL_PAGE_TIMEOUT_MS)
        const subEmails = extractEmailsFromHtml(subHtml, link, 'website_contact')
        for (const se of subEmails) {
          if (!discoveredEmails.some((e) => e.email === se.email)) {
            discoveredEmails.push(se)
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        console.warn(`Internal page crawl failed for ${link}:`, errMsg)
        try {
          const parsedLink = new URL(link)
          brokenContactLinks.push(`${parsedLink.pathname} (${errMsg})`)
        } catch {
          brokenContactLinks.push(`${link} (${errMsg})`)
        }
      }
    }

    // Step 3: Await PageSpeed Insights Lab Metrics
    const pageSpeedMetrics = await pageSpeedPromise

    // Step 4: Run Multi-Dimensional Website Audit with Grounded Signals
    const audit: AuditResult = auditWebsite(homepageHtml, siteUrl, {
      pageSpeed: pageSpeedMetrics,
      brokenLinks: brokenContactLinks,
      phoneCandidates,
    })

    // Step 3b: Fallback to Domain MX Mailbox synthesis if site has no visible email
    if (discoveredEmails.length === 0) {
      try {
        const domain = new URL(siteUrl).hostname.replace(/^www\./, '')
        const hasMx = await checkDomainMx(domain)
        if (hasMx) {
          const candidatePrefixes = ['info', 'contact', 'office', 'sales', 'estimates', 'support']
          for (const prefix of candidatePrefixes) {
            const synthEmail = `${prefix}@${domain}`
            discoveredEmails.push({
              email: synthEmail,
              type: prefix === 'sales' || prefix === 'estimates' ? 'sales' : 'general',
              confidence: 'MEDIUM',
              source: 'verified_domain_mx',
              sourceUrl: siteUrl,
            })
          }
        }
      } catch {
        // ignore
      }
    }

    // Filter out suppressed emails (bounces / complaints)
    const validEmails: DiscoveredEmail[] = []
    for (const item of discoveredEmails) {
      if (!(await isSuppressedEmail(item.email))) {
        validEmails.push(item)
      }
    }

    // Step 5: Persist Discovered Contacts to `lead_contacts`
    if (validEmails.length > 0) {
      for (const item of validEmails) {
        await pool.query(
          `INSERT INTO lead_contacts (lead_id, email, email_type, source, confidence, source_url)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT DO NOTHING`,
          [leadId, item.email, item.type, item.source, item.confidence, item.sourceUrl || siteUrl]
        )
      }
    }

    // Step 6: Select Best Candidate Email for Outreach
    let bestEmailObj: DiscoveredEmail | null = null
    if (validEmails.length > 0) {
      validEmails.sort((a, b) => scoreEmailForOutreach(b, siteUrl) - scoreEmailForOutreach(a, siteUrl))
      bestEmailObj = validEmails[0]
    }

    const emailToUse = bestEmailObj?.email || lead.email || null
    const emailConfidence = bestEmailObj?.confidence || (lead.email ? 'MEDIUM' : null)
    const emailSource = bestEmailObj?.source || (lead.email ? 'pre_existing' : null)
    const emailSourceUrl = bestEmailObj?.sourceUrl || null

    // Determine status: 'scraped' if email exists, 'email_needed' if website audited but email missing
    const newStatus = emailToUse ? 'scraped' : 'email_needed'

    const verifiedFactsBlock =
      audit.verifiedFacts.length > 0
        ? `\nVerified Observations:\n${audit.verifiedFacts.map((f) => `- ${f}`).join('\n')}`
        : ''

    const scrapedContent = `Business Name: ${businessName}
Address: ${address}
Website: ${siteUrl}
SEO Score: ${audit.seoScore}/100
Mobile Score: ${audit.mobileScore}/100
Design Score: ${audit.designScore}/100
Performance Score: ${audit.performanceScore}/100
UX Score: ${audit.uxScore}/100
Primary Outreach Angle: ${audit.outreachAngle} (${audit.outreachReason})${verifiedFactsBlock}
Top Issues: ${audit.topIssues.map((i) => `${i.title}: ${i.detail}`).join('; ')}
Quick Wins: ${audit.quickWins.join('; ')}

Website Content Summary:
${homeBodyText || 'Minimal text extracted.'}`

    await pool.query(
      `UPDATE leads SET
         scraped_content = $1,
         email = $2,
         email_source = $3,
         email_confidence = $4,
         email_source_url = $5,
         email_verification_status = CASE WHEN $4::text = 'HIGH' AND $5::text IS NOT NULL AND $3::text IS DISTINCT FROM 'ai_extracted' THEN 'source_verified' ELSE 'needs_review' END,
         email_verified_at = CASE WHEN $4::text = 'HIGH' AND $5::text IS NOT NULL AND $3::text IS DISTINCT FROM 'ai_extracted' THEN NOW() ELSE NULL END,
         email_verification_method = CASE WHEN $4::text = 'HIGH' AND $5::text IS NOT NULL AND $3::text IS DISTINCT FROM 'ai_extracted' THEN 'website-source-check' ELSE NULL END,
         phone = COALESCE($6, phone),
         status = $7,
         seo_score = $8,
         mobile_score = $9,
         performance_score = $10,
         design_score = $11,
         ux_score = $12,
         technical_score = $13,
         opportunity_score = $14,
         outreach_angle = $15,
         outreach_reason = $16,
         audit_details = $17,
         last_audited_at = NOW(),
         audit_attempts = 0,
         audit_next_attempt_at = NULL
       WHERE id = $18`,
      [
        scrapedContent,
        emailToUse,
        emailSource,
        emailConfidence,
        emailSourceUrl,
        primaryPhone,
        newStatus,
        audit.seoScore,
        audit.mobileScore,
        audit.performanceScore,
        audit.designScore,
        audit.uxScore,
        audit.technicalScore,
        audit.opportunityScore,
        audit.outreachAngle,
        audit.outreachReason,
        JSON.stringify(audit),
        leadId,
      ]
    )

    return true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Scrape/audit error for lead ${leadId} (${siteUrl}):`, message)

    // DO NOT DELETE LEAD ON FAILURE: mark email_needed for retry / search enrichment
    const fallbackContent = `Business Name: ${businessName}\nAddress: ${address}\nWebsite: ${siteUrl}\n(Audit attempt failed: ${message})`
    await pool.query(
      `UPDATE leads SET
         scraped_content = COALESCE(scraped_content, $1),
         status = CASE
           WHEN status IN ('new', 'email_needed') AND COALESCE(audit_attempts, 0) + 1 >= 3 THEN 'email_needed'
           WHEN status IN ('new', 'email_needed') THEN 'new'
           ELSE status
         END,
         audit_attempts = COALESCE(audit_attempts, 0) + 1,
         audit_next_attempt_at = CASE
           WHEN COALESCE(audit_attempts, 0) + 1 >= 3 THEN NULL
           ELSE NOW() + (INTERVAL '1 day' * POWER(2, COALESCE(audit_attempts, 0)))
         END
       WHERE id = $2`,
      [fallbackContent, leadId]
    )

    return false
  }
}
