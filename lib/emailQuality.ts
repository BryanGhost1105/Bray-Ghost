export type EmailConfidence = 'HIGH' | 'MEDIUM' | 'LOW'
export type EmailType = 'owner' | 'sales' | 'support' | 'general' | 'management' | 'other'

export interface DiscoveredEmail {
  email: string
  type: EmailType
  confidence: EmailConfidence
  source: string
  sourceUrl?: string
}

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g

const GARBAGE_PREFIXES = new Set([
  'example',
  'test',
  'user',
  'email',
  'your',
  'yourname',
  'username',
  'name',
  'john.doe',
  'johndoe',
  'sample',
  'demo',
  'someone',
  'null',
  'undefined',
  'error',
  'error-lite',
  'abuse',
  'hostmaster',
  'postmaster',
  'webmaster',
  'security',
  'compliance',
  'legal',
  'privacy',
  'dpo',
  'root',
  'daemon',
])

const GARBAGE_DOMAINS = new Set([
  'example.com',
  'example.org',
  'example.net',
  'test.com',
  'domain.com',
  'yourdomain.com',
  'company.com',
  'mycompany.com',
  'sentry.io',
  'wixpress.com',
  'w3.org',
  'schema.org',
  'github.com',
  'gitlab.com',
  'cloudflare.com',
  'gravatar.com',
  'wordpress.org',
  'wp.com',
  'googleapis.com',
  'placeholder.com',
  'email.com',
  'yoursite.com',
  'mysite.com',
  'duckduckgo.com',
  'duck.com',
  'bing.com',
  'google.com',
  'googlemail.com',
  'yahoo.com',
  'yandex.com',
  'baidu.com',
  'microsoft.com',
  'apple.com',
  'yelp.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'yellowpages.com',
  'bbb.org',
  'tripadvisor.com',
  'angieslist.com',
  'homeadvisor.com',
  'thumbtack.com',
  'nextdoor.com',
  'manta.com',
  'superpages.com',
  'chamberofcommerce.com',
  'zoominfo.com',
  'dnb.com',
  'mapquest.com',
  'foursquare.com',
  'whois.com',
  'godaddy.com',
  'namecheap.com',
  'squarespace.com',
  'weebly.com',
  'shopify.com',
  'wix.com',
  'sentry-next.wixpress.com',
])

const INVALID_TLDS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'svg',
  'webp',
  'avif',
  'ico',
  'bmp',
  'tiff',
  'css',
  'js',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'mp4',
  'webm',
  'pdf',
  'zip',
  'json',
  'xml',
  'html',
  'htm',
  'php',
  'asp',
  'aspx',
  'exe',
  'bin',
  'tar',
  'gz',
])

const FILE_EXT_REGEX = /\.(png|jpg|jpeg|gif|svg|webp|avif|ico|bmp|tiff|css|js|woff|woff2|ttf|eot|mp4|webm|pdf|zip)$/i

/**
 * Normalizes obfuscated email patterns in text:
 * - "info [at] company.com" -> "info@company.com"
 * - "info(at)company.com" -> "info@company.com"
 * - "info AT company DOT com" -> "info@company.com"
 */
export function normalizeObfuscatedEmails(rawText: string): string {
  if (!rawText) return ''

  return rawText
    .replace(/\s*\[\s*at\s*\]\s*/gi, '@')
    .replace(/\s*\(\s*at\s*\)\s*/gi, '@')
    .replace(/\s+AT\s+/g, '@')
    .replace(/\s*\[\s*dot\s*\]\s*/gi, '.')
    .replace(/\s*\(\s*dot\s*\)\s*/gi, '.')
    .replace(/\s+DOT\s+/g, '.')
}

/**
 * Validates whether an email string is structurally sound and not a known placeholder / telemetry email.
 */
export function isValidBusinessEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false
  const trimmed = email.trim().toLowerCase()

  if (trimmed.length < 5 || trimmed.length > 100) return false
  if (trimmed.includes(' ') || trimmed.includes('..')) return false

  // Reject retina image assets e.g. logo@2x.png, icon@3x.jpg
  if (/@\d+x\./i.test(trimmed)) {
    return false
  }

  // Must match standard email pattern
  if (!/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(trimmed)) {
    return false
  }

  // Reject file extensions anywhere
  if (FILE_EXT_REGEX.test(trimmed)) {
    return false
  }

  const [localPart, domainPart] = trimmed.split('@')
  if (!localPart || !domainPart) return false

  // Strip '+' alias for prefix check, e.g. error-lite+9c39 -> error-lite
  const baseLocalPart = localPart.split('+')[0]

  if (GARBAGE_PREFIXES.has(localPart) || GARBAGE_PREFIXES.has(baseLocalPart)) return false
  if (GARBAGE_DOMAINS.has(domainPart)) return false

  // Check if domain ends with any garbage domain (e.g. subdomains like error.duckduckgo.com)
  for (const gd of GARBAGE_DOMAINS) {
    if (domainPart === gd || domainPart.endsWith(`.${gd}`)) {
      return false
    }
  }

  // Reject obvious no-reply / automated / error inboxes
  if (
    /^(error|abuse|noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce|hostmaster|webmaster|dpo|privacy|legal|security)/i.test(
      localPart
    )
  ) {
    return false
  }

  // Domain must have at least one dot and valid TLD length
  const parts = domainPart.split('.')
  if (parts.length < 2) return false
  const tld = parts[parts.length - 1].toLowerCase()
  if (tld.length < 2 || !/^[a-z]+$/i.test(tld)) return false

  // Reject image or asset TLDs
  if (INVALID_TLDS.has(tld)) {
    return false
  }

  return true
}

/**
 * Classifies the role / department of an email address.
 */
export function classifyEmailType(email: string): EmailType {
  const localPart = email.split('@')[0].toLowerCase()

  if (/^(owner|founder|ceo|president|principal)/i.test(localPart)) {
    return 'owner'
  }
  if (/^(management|manager|director|gm|vp)/i.test(localPart)) {
    return 'management'
  }
  if (/^(sales|estimates|quotes|quote|pricing|service|services|projects|bids|commercial|residential)/i.test(localPart)) {
    return 'sales'
  }
  if (/^(support|help|care|customercare|service-desk|assistance)/i.test(localPart)) {
    return 'support'
  }
  if (/^(info|contact|hello|office|admin|inquiries|mail|team|frontdesk|reception)/i.test(localPart)) {
    return 'general'
  }

  return 'other'
}

/**
 * Determines email confidence relative to the target business website domain.
 */
export function evaluateEmailConfidence(
  email: string,
  siteUrl?: string | null,
  source?: string
): EmailConfidence {
  const emailDomain = email.split('@')[1]?.toLowerCase()

  if (siteUrl) {
    try {
      const formatted = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`
      const siteHostname = new URL(formatted).hostname.toLowerCase().replace(/^www\./, '')
      if (emailDomain === siteHostname || emailDomain.endsWith(`.${siteHostname}`)) {
        return 'HIGH'
      }
    } catch {
      // url parse error
    }
  }

  if (source === 'website_page' || source === 'website_contact' || source === 'website_homepage') {
    return 'HIGH'
  }

  if (source === 'search_snippet' || source === 'search_fallback') {
    return 'MEDIUM'
  }

  return 'LOW'
}

/**
 * Score emails to pick the best candidate for outreach.
 * Personal/Owner emails score highest, followed by Sales and General.
 */
export function scoreEmailForOutreach(item: DiscoveredEmail, siteUrl?: string | null): number {
  let score = 50

  if (item.confidence === 'HIGH') score += 30
  else if (item.confidence === 'MEDIUM') score += 15
  else score -= 20

  switch (item.type) {
    case 'owner':
      score += 25
      break
    case 'management':
      score += 20
      break
    case 'sales':
      score += 15
      break
    case 'general':
      score += 10
      break
    case 'other':
      score += 5
      break
    case 'support':
      score += 0
      break
  }

  if (siteUrl) {
    try {
      const formatted = /^https?:\/\//i.test(siteUrl) ? siteUrl : `https://${siteUrl}`
      const siteHostname = new URL(formatted).hostname.toLowerCase().replace(/^www\./, '')
      const emailDomain = item.email.split('@')[1]?.toLowerCase()
      if (emailDomain === siteHostname) score += 20
    } catch {
      // ignore
    }
  }

  return score
}

/**
 * Extracts and normalizes all valid email addresses from raw text / HTML content.
 */
export function parseAllValidEmails(
  text: string,
  options?: { source?: string; siteUrl?: string | null; defaultConfidence?: EmailConfidence }
): DiscoveredEmail[] {
  if (!text) return []

  const deobfuscated = normalizeObfuscatedEmails(text)
  const matches = deobfuscated.match(EMAIL_REGEX) || []

  const results: DiscoveredEmail[] = []
  const seen = new Set<string>()

  for (const raw of matches) {
    const cleaned = raw.trim().toLowerCase().replace(/[.,;:)\]]+$/, '')
    if (isValidBusinessEmail(cleaned) && !seen.has(cleaned)) {
      seen.add(cleaned)
      const emailType = classifyEmailType(cleaned)
      const confidence =
        options?.defaultConfidence ||
        evaluateEmailConfidence(cleaned, options?.siteUrl, options?.source)

      results.push({
        email: cleaned,
        type: emailType,
        confidence,
        source: options?.source || 'website',
        sourceUrl: options?.siteUrl || undefined,
      })
    }
  }

  return results
}
