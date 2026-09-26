import * as cheerio from 'cheerio'
import type { PageSpeedMetrics } from './pagespeed'

export type OutreachAngle = 'mobile' | 'seo' | 'design' | 'performance' | 'conversion'

export interface AuditIssue {
  category: 'seo' | 'mobile' | 'performance' | 'design' | 'ux' | 'technical'
  severity: 'high' | 'medium' | 'low'
  title: string
  detail: string
  recommendation: string
}

export interface AuditResult {
  seoScore: number
  mobileScore: number
  performanceScore: number
  designScore: number
  uxScore: number
  technicalScore: number
  opportunityScore: number
  outreachAngle: OutreachAngle
  outreachReason: string
  secondaryAngle?: OutreachAngle
  topIssues: AuditIssue[]
  quickWins: string[]
  verifiedFacts: string[] // Concrete, measured facts for AI generation verbatim citation
  pageSpeed?: PageSpeedMetrics | null
  details: {
    title: string
    metaDescription: string
    hasViewport: boolean
    h1Count: number
    wordCount: number
    imageCount: number
    imagesWithoutAlt: number
    hasStructuredData: boolean
    hasLocalBusinessSchema: boolean
    hasCanonical: boolean
    hasOpenGraph: boolean
    hasPhoneLink: boolean
    hasContactForm: boolean
    hasHeroSection: boolean
    hasCta: boolean
    isHttps: boolean
    copyrightYear: number | null
    yearsStale: number | null
    builderSubdomain: string | null
    brokenContactLinks: string[]
    scriptCount: number
    stylesheetCount: number
    htmlSizeBytes: number
  }
}

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

/**
 * Extracts copyright year from HTML footer or page text.
 */
export function extractCopyrightYear(html: string): number | null {
  const currentYear = new Date().getFullYear()
  // Look for © 2018, &copy; 2019, Copyright 2017, Copyright (c) 2015-2020
  const match = html.match(/(?:©|&copy;|copyright|\(c\))\s*(?:[0-9]{4}\s*[-–/]\s*)?([12][0-9]{3})/i)
  if (match && match[1]) {
    const year = parseInt(match[1], 10)
    if (year >= 1995 && year <= currentYear + 1) {
      return year
    }
  }
  return null
}

/**
 * Detects whether the website runs on a free builder subdomain.
 */
export function detectBuilderSubdomain(url: string): string | null {
  try {
    const host = new URL(url).hostname.toLowerCase()
    const builderPatterns: [RegExp, string][] = [
      [/\.wixsite\.com$/i, 'Wix free subdomain'],
      [/\.weebly\.com$/i, 'Weebly free subdomain'],
      [/\.squarespace\.com$/i, 'Squarespace uncustomized domain'],
      [/\.godaddysites\.com$/i, 'GoDaddy Sites free subdomain'],
      [/\.wordpress\.com$/i, 'WordPress.com free subdomain'],
      [/\.webflow\.io$/i, 'Webflow staging subdomain'],
      [/\.site123\.me$/i, 'Site123 free subdomain'],
      [/\.jimdosite\.com$/i, 'Jimdo free subdomain'],
    ]

    for (const [pattern, label] of builderPatterns) {
      if (pattern.test(host)) {
        return label
      }
    }
  } catch {
    // ignore
  }
  return null
}

/**
 * Checks if JSON-LD contains LocalBusiness, Organization, or relevant local schema.
 */
export function checkLocalBusinessSchema(html: string): boolean {
  try {
    const $ = cheerio.load(html)
    const scripts = $('script[type="application/ld+json"]')
    let hasLocal = false
    scripts.each((_, el) => {
      try {
        const content = $(el).html()
        if (content && /LocalBusiness|Store|Organization|Restaurant|Plumber|Electrician|HVACBusiness|ProfessionalService/i.test(content)) {
          hasLocal = true
        }
      } catch {
        // ignore
      }
    })
    return hasLocal
  } catch {
    return false
  }
}

/**
 * Performs a deep static HTML & lab metrics audit of a business website.
 */
export function auditWebsite(
  html: string,
  url: string,
  options?: {
    discoverySignals?: { userRatingCount?: number | null; rating?: number | null; pageIndex?: number }
    pageSpeed?: PageSpeedMetrics | null
    brokenLinks?: string[]
    phoneCandidates?: string[]
  }
): AuditResult {
  const $ = cheerio.load(html)
  const isHttps = /^https:\/\//i.test(url)
  const htmlSizeBytes = Buffer.byteLength(html, 'utf8')
  const currentYear = new Date().getFullYear()

  // Clone text content for word count analysis
  const textClone = cheerio.load(html)
  textClone('script, style, noscript, nav, footer, svg').remove()
  const bodyText = textClone('body').text().replace(/\s+/g, ' ').trim()
  const wordCount = bodyText ? bodyText.split(/\s+/).length : 0

  const issues: AuditIssue[] = []
  const quickWins: string[] = []
  const verifiedFacts: string[] = []

  // 1. SEO AUDIT SIGNALS
  let seo = 100
  const title = $('title').first().text().trim()
  const metaDescription =
    $('meta[name="description" i], meta[property="og:description" i]')
      .first()
      .attr('content')
      ?.trim() || ''
  const canonical = $('link[rel="canonical" i]').attr('href')?.trim() || ''
  const hasOpenGraph = $('meta[property^="og:" i]').length > 0
  const structuredDataCount = $('script[type="application/ld+json"]').length
  const hasLocalSchema = checkLocalBusinessSchema(html)
  const h1Elements = $('h1')
  const h1Count = h1Elements.length
  const images = $('img')
  const imageCount = images.length
  let imagesWithoutAlt = 0
  images.each((_, el) => {
    const alt = $(el).attr('alt')
    if (alt === undefined || alt.trim() === '') {
      imagesWithoutAlt++
    }
  })

  if (!title) {
    seo -= 25
    issues.push({
      category: 'seo',
      severity: 'high',
      title: 'Missing Page Title',
      detail: 'The website has no <title> tag, preventing search engines from properly displaying the site name.',
      recommendation: 'Add an optimized title tag featuring the primary service and target city.',
    })
    quickWins.push('Add an optimized page <title> tag with city + service.')
    verifiedFacts.push('Missing <title> tag in homepage HTML.')
  } else if (title.length < 15) {
    seo -= 10
    issues.push({
      category: 'seo',
      severity: 'medium',
      title: 'Very Short Title Tag',
      detail: `The title tag is only ${title.length} characters long and may lack keyword relevance.`,
      recommendation: 'Expand the title tag to 45-60 characters including service keywords and location.',
    })
  } else if (title.length > 70) {
    seo -= 5
  }

  if (!metaDescription) {
    seo -= 20
    issues.push({
      category: 'seo',
      severity: 'high',
      title: 'Missing Meta Description',
      detail: 'Search engines must automatically guess snippets in search results because no meta description exists.',
      recommendation: 'Write a compelling 150-160 character meta description emphasizing service trust and location.',
    })
    quickWins.push('Add a 155-character meta description with a call to action.')
    verifiedFacts.push('No meta description tag on homepage for Google search snippets.')
  } else if (metaDescription.length < 40) {
    seo -= 10
    issues.push({
      category: 'seo',
      severity: 'low',
      title: 'Short Meta Description',
      detail: 'The meta description is brief and does not fully utilize available search snippet real estate.',
      recommendation: 'Expand the description to ~150 characters to boost search click-through rates.',
    })
  }

  if (h1Count === 0) {
    seo -= 15
    issues.push({
      category: 'seo',
      severity: 'high',
      title: 'Missing H1 Heading',
      detail: 'No <h1> tag was found. H1 headings establish page topic hierarchy for Google and users.',
      recommendation: 'Add a clear primary <h1> headline on the homepage stating the main value proposition.',
    })
    quickWins.push('Add a single clear <h1> headline with core business offering.')
    verifiedFacts.push('No primary <h1> headline detected.')
  }

  if (imageCount > 0 && imagesWithoutAlt > 0) {
    const altRatio = imagesWithoutAlt / imageCount
    if (altRatio > 0.4) {
      seo -= 12
      issues.push({
        category: 'seo',
        severity: 'medium',
        title: 'Missing Image Alt Attributes',
        detail: `${imagesWithoutAlt} of ${imageCount} images lack alt descriptions for accessibility and image search.`,
        recommendation: 'Add descriptive alt text to all key service and project photos.',
      })
    }
  }

  if (!hasLocalSchema) {
    seo -= 15
    issues.push({
      category: 'seo',
      severity: 'medium',
      title: 'Missing LocalBusiness Schema Markup',
      detail: 'Website lacks LocalBusiness structured data (JSON-LD), which helps Google display rich snippets, business hours, and knowledge cards.',
      recommendation: 'Implement LocalBusiness JSON-LD schema with address, phone, opening hours, and service catalog.',
    })
    quickWins.push('Add LocalBusiness Schema markup for Google Maps & rich search snippets.')
    verifiedFacts.push('No Schema.org LocalBusiness structured data markup.')
  }

  if (!canonical) {
    seo -= 8
  }

  if (wordCount < 200) {
    seo -= 15
    issues.push({
      category: 'seo',
      severity: 'medium',
      title: 'Thin On-Page Content',
      detail: `The page contains only ~${wordCount} words of text, which may limit keyword ranking ability.`,
      recommendation: 'Expand homepage copy with detailed service descriptions, service areas, and FAQs.',
    })
  }

  // 2. MOBILE & RESPONSIVE AUDIT
  let mobile = 100
  const viewportTag = $('meta[name="viewport" i]').attr('content') || ''
  const hasViewport = Boolean(viewportTag && viewportTag.includes('width='))
  const hasMediaQueries = /@media[^{]*\{/i.test(html)
  const hasResponsiveFramework = /(tailwind|bootstrap|flex|grid|col-|w-full|max-w-|sm:|md:|lg:)/i.test(html)
  const hasPictureOrSrcset = $('picture, img[srcset], source[srcset]').length > 0
  const hasMobileNav = /(navbar-toggler|menu-toggle|hamburger|mobile-menu|nav-toggle|aria-label=".*menu.*")/i.test(html)
  const hasTelLink = $('a[href^="tel:" i]').length > 0
  const detectedPhones = options?.phoneCandidates || []

  if (!hasViewport) {
    mobile -= 45
    issues.push({
      category: 'mobile',
      severity: 'high',
      title: 'Missing Mobile Viewport Meta Tag',
      detail: 'The website lacks a mobile viewport tag, causing smartphones to display desktop-scaled pages with tiny text.',
      recommendation: 'Add <meta name="viewport" content="width=device-width, initial-scale=1.0"> immediately.',
    })
    quickWins.push('Add viewport meta tag so mobile devices scale the site correctly.')
    verifiedFacts.push('No mobile viewport tag (<meta name="viewport"> missing).')
  }

  if (!hasMediaQueries && !hasResponsiveFramework) {
    mobile -= 25
    issues.push({
      category: 'mobile',
      severity: 'high',
      title: 'Fixed Desktop Layout Detected',
      detail: 'No responsive CSS media queries or modern responsive layout utilities were detected.',
      recommendation: 'Modernize layout using a responsive grid/flexbox stylesheet.',
    })
  }

  if ($('img').length > 0 && !hasPictureOrSrcset) {
    mobile -= 3
    quickWins.push('Use responsive image sources so mobile visitors receive appropriately sized assets.')
  }

  if ($('nav').length > 0 && !hasMobileNav) {
    mobile -= 4
    quickWins.push('Check the navigation at narrow widths and provide a clear mobile menu control.')
  }

  if (!hasTelLink && detectedPhones.length > 0) {
    mobile -= 18
    const samplePhone = detectedPhones[0]
    issues.push({
      category: 'mobile',
      severity: 'high',
      title: 'No One-Tap Click-to-Call Link',
      detail: `The phone number (${samplePhone}) is displayed as plain text without a tap-to-call link (<a href="tel:...">).`,
      recommendation: 'Wrap all contact phone numbers in one-tap click-to-call links.',
    })
    quickWins.push('Add tap-to-call links (tel:) for mobile smartphone visitors.')
    verifiedFacts.push(`Phone number (${samplePhone}) has no clickable tap-to-call link (<a href="tel:"> missing).`)
  } else if (!hasTelLink) {
    mobile -= 10
  }

  // 3. PERFORMANCE AUDIT (PageSpeed Lab Metrics + Static)
  let performance = 100
  const scriptTags = $('script[src]')
  const scriptCount = scriptTags.length
  const stylesheetTags = $('link[rel="stylesheet" i]')
  const stylesheetCount = stylesheetTags.length
  let lazyImageCount = 0
  images.each((_, el) => {
    if ($(el).attr('loading') === 'lazy') lazyImageCount++
  })

  // Integrate PageSpeed Insights if available
  const ps = options?.pageSpeed
  if (ps && typeof ps.performanceScore === 'number') {
    performance = ps.performanceScore
    if (ps.largestContentfulPaint) {
      verifiedFacts.push(`Measured mobile load time (LCP): ${ps.largestContentfulPaint} (Google PageSpeed score: ${ps.performanceScore}/100).`)
    } else {
      verifiedFacts.push(`Google PageSpeed mobile performance score: ${ps.performanceScore}/100.`)
    }

    if (ps.performanceScore < 50) {
      issues.push({
        category: 'performance',
        severity: 'high',
        title: 'Poor Mobile Performance (Google Lighthouse)',
        detail: `Google PageSpeed measured a mobile performance score of ${ps.performanceScore}/100${ps.largestContentfulPaint ? ` with a ${ps.largestContentfulPaint} load time` : ''}.`,
        recommendation: 'Optimize hero media, reduce render-blocking assets, and enable modern compression.',
      })
      quickWins.push(`Improve mobile load speed from ${ps.largestContentfulPaint || 'current slow baseline'}.`)
    }
  } else {
    // Static heuristic fallback
    if (htmlSizeBytes > 300000) {
      performance -= 25
      issues.push({
        category: 'performance',
        severity: 'medium',
        title: 'Large HTML Document Size',
        detail: `The raw HTML payload is ${(htmlSizeBytes / 1024).toFixed(0)} KB, which slows initial page render.`,
        recommendation: 'Clean up inline scripts, styles, and bloated DOM structures.',
      })
    } else if (htmlSizeBytes > 150000) {
      performance -= 12
    }

    if (scriptCount > 15) {
      performance -= 20
    }
    if (imageCount > 5 && lazyImageCount === 0) {
      performance -= 15
      quickWins.push('Enable loading="lazy" on images to accelerate mobile page loading.')
    }
  }

  // 4. DESIGN & STALENESS AUDIT
  let design = 100
  const hasModernFonts = /(fonts\.googleapis\.com|use\.typekit\.net|font-family|font-sans|font-serif|inter|roboto|montserrat|poppins|open-sans)/i.test(html)
  const hasModernCss = /(var\(--|border-radius|box-shadow|backdrop-filter|gradient|transition|transform|grid|flex)/i.test(html)
  const hasHeroSection = /(hero|banner|jumbotron|intro|header-main|headline-section)/i.test(html) || $('section').length > 0
  const hasCta = /(btn|button|cta|call-to-action|quote-btn|contact-btn|schedule-btn)/i.test(html) || $('a.button, a.btn, button').length > 0
  const hasFavicon = $('link[rel*="icon" i]').length > 0

  // Stale content check (Copyright year)
  const copyrightYear = extractCopyrightYear(html)
  let yearsStale: number | null = null
  if (copyrightYear) {
    yearsStale = currentYear - copyrightYear
    if (yearsStale >= 2) {
      design -= Math.min(25, yearsStale * 5)
      issues.push({
        category: 'design',
        severity: yearsStale >= 4 ? 'high' : 'medium',
        title: 'Outdated Footer Copyright Date',
        detail: `The website footer displays a copyright year of ${copyrightYear} (${yearsStale} years out of date), signaling an unmaintained website.`,
        recommendation: `Update the footer copyright to ${currentYear} and refresh dated business content.`,
      })
      quickWins.push(`Update website copyright year from ${copyrightYear} to ${currentYear}.`)
      verifiedFacts.push(`Website footer copyright date is ${copyrightYear} (${yearsStale} years out of date).`)
    }
  }

  // Free Builder Subdomain check
  const builderSubdomain = detectBuilderSubdomain(url)
  if (builderSubdomain) {
    design -= 25
    issues.push({
      category: 'technical',
      severity: 'high',
      title: 'Free Builder Subdomain in Use',
      detail: `The website runs on a ${builderSubdomain} rather than a dedicated custom domain (e.g., yourbusiness.com).`,
      recommendation: 'Migrate to a custom branded domain name with professional email forwarding.',
    })
    quickWins.push('Connect a custom domain name to replace the free builder subdomain.')
    verifiedFacts.push(`Website is hosted on a ${builderSubdomain} instead of a custom domain.`)
  }

  if (!hasCta) {
    design -= 25
    issues.push({
      category: 'design',
      severity: 'high',
      title: 'Missing Prominent Call-to-Action (CTA)',
      detail: 'No high-contrast primary action button (e.g. "Request Free Quote" or "Book Service") was detected in the hero.',
      recommendation: 'Place a bold, high-contrast CTA button above the fold.',
    })
    quickWins.push('Add a bold primary CTA button above the fold to capture leads.')
    verifiedFacts.push('No prominent primary call-to-action button above the fold.')
  }

  if (!hasModernFonts) {
    design -= 4
    quickWins.push('Use a consistent web-safe or intentionally loaded type scale for stronger visual hierarchy.')
  }

  if (!hasModernCss) {
    design -= 4
    quickWins.push('Review spacing, layout, and component styling for a more consistent visual system.')
  }

  if (!hasFavicon) {
    design -= 8
  }

  // 5. UX & CONVERSION AUDIT
  let ux = 100
  const forms = $('form')
  const hasContactForm = forms.length > 0
  const brokenLinks = options?.brokenLinks || []

  if (brokenLinks.length > 0) {
    ux -= 35
    issues.push({
      category: 'ux',
      severity: 'high',
      title: 'Broken Contact Page Link Detected',
      detail: `Contact link returned an error when accessed: ${brokenLinks.join(', ')}.`,
      recommendation: 'Fix the broken contact link or update URL routing immediately.',
    })
    quickWins.push('Fix broken contact page navigation link.')
    verifiedFacts.push(`Broken contact link detected: ${brokenLinks.join(', ')}.`)
  }

  if (!hasContactForm && !hasTelLink) {
    ux -= 30
    issues.push({
      category: 'ux',
      severity: 'high',
      title: 'No Direct Lead Capture Channel',
      detail: 'Visitors have no contact form or click-to-call button to request service directly from the page.',
      recommendation: 'Add a streamlined 3-field quote request form and prominent phone number.',
    })
    verifiedFacts.push('No online inquiry/contact form and no tap-to-call link.')
  } else if (!hasContactForm) {
    ux -= 15
    issues.push({
      category: 'ux',
      severity: 'medium',
      title: 'No Online Quote Request Form',
      detail: 'Customers who prefer online inquiries must manually open their email app or call.',
      recommendation: 'Add an instant estimate/quote inquiry form on the homepage.',
    })
    quickWins.push('Add a quick quote request form to convert after-hours web visitors.')
    verifiedFacts.push('No online quote request form detected on homepage.')
  }

  // 6. TECHNICAL AUDIT
  let technical = 100
  if (!isHttps) {
    technical -= 40
    issues.push({
      category: 'technical',
      severity: 'high',
      title: 'Insecure HTTP Connection (No SSL)',
      detail: 'The website is served over unencrypted HTTP, triggering "Not Secure" browser warnings to visitors.',
      recommendation: 'Install an SSL certificate and force HTTPS redirection across all URLs.',
    })
    quickWins.push('Enable free SSL / HTTPS to remove "Not Secure" browser warnings.')
    verifiedFacts.push('Website lacks SSL certificate (loads over unencrypted HTTP with browser warning).')
  }

  const doctype = /^<!doctype html/i.test(html.trim())
  if (!doctype) technical -= 15

  // Clamping scores
  const finalSeo = clamp(seo)
  const finalMobile = clamp(mobile)
  const finalPerformance = clamp(performance)
  const finalDesign = clamp(design)
  const finalUx = clamp(ux)
  const finalTechnical = clamp(technical)

  // 7. OPPORTUNITY SCORE CALCULATION
  const qualityScore =
    finalMobile * 0.25 +
    finalDesign * 0.20 +
    finalUx * 0.20 +
    finalSeo * 0.15 +
    finalPerformance * 0.10 +
    finalTechnical * 0.10

  let opportunityScore = clamp(100 - qualityScore)

  if (options?.discoverySignals?.userRatingCount && options.discoverySignals.userRatingCount > 10 && opportunityScore > 40) {
    opportunityScore = clamp(opportunityScore + 5)
  }

  // 8. SELECT STRONGEST OUTREACH ANGLE
  const candidates: { angle: OutreachAngle; score: number; reason: string }[] = [
    {
      angle: 'mobile',
      score: finalMobile,
      reason: !hasViewport
        ? 'Website completely lacks a mobile viewport tag, making it difficult to read on smartphones.'
        : !hasTelLink && detectedPhones.length > 0
        ? `Phone number (${detectedPhones[0]}) has no one-tap click-to-call link for smartphone users.`
        : 'Mobile responsiveness and layout scaling need optimization for smartphone visitors.',
    },
    {
      angle: 'conversion',
      score: finalUx,
      reason: brokenLinks.length > 0
        ? `Contact page link is broken (${brokenLinks[0]}), losing prospective customers.`
        : !hasContactForm
        ? 'Website lacks an online quote request form to capture high-intent leads.'
        : 'Missing direct conversion paths and quote request forms.',
    },
    {
      angle: 'design',
      score: finalDesign,
      reason: builderSubdomain
        ? `Business is running on a ${builderSubdomain} instead of a custom branded domain.`
        : yearsStale && yearsStale >= 2
        ? `Footer copyright is dated ${copyrightYear} (${yearsStale} years out of date).`
        : !hasCta
        ? 'Website does not have a prominent primary call-to-action above the fold.'
        : 'Website visual presentation and layout look dated compared to local competitors.',
    },
    {
      angle: 'seo',
      score: finalSeo,
      reason: !hasLocalSchema
        ? 'Website lacks LocalBusiness Schema.org structured data for Google rankings and rich snippets.'
        : !metaDescription
        ? 'Website is missing a meta description for Google search snippets.'
        : 'On-page SEO signals and local search markup are incomplete.',
    },
    {
      angle: 'performance',
      score: finalPerformance,
      reason: ps?.largestContentfulPaint
        ? `Measured mobile load time of ${ps.largestContentfulPaint} (PageSpeed score: ${finalPerformance}/100).`
        : 'Website loads multiple unoptimized assets that slow down mobile load times.',
    },
  ]

  candidates.sort((a, b) => a.score - b.score)

  const primary = candidates[0]
  const secondary = candidates[1]

  return {
    seoScore: finalSeo,
    mobileScore: finalMobile,
    performanceScore: finalPerformance,
    designScore: finalDesign,
    uxScore: finalUx,
    technicalScore: finalTechnical,
    opportunityScore,
    outreachAngle: primary.angle,
    outreachReason: primary.reason,
    secondaryAngle: secondary?.angle,
    topIssues: issues.slice(0, 5),
    quickWins: Array.from(new Set(quickWins)).slice(0, 3),
    verifiedFacts: Array.from(new Set(verifiedFacts)),
    pageSpeed: ps || null,
    details: {
      title,
      metaDescription,
      hasViewport,
      h1Count,
      wordCount,
      imageCount,
      imagesWithoutAlt,
      hasStructuredData: structuredDataCount > 0,
      hasLocalBusinessSchema: hasLocalSchema,
      hasCanonical: Boolean(canonical),
      hasOpenGraph,
      hasPhoneLink: hasTelLink,
      hasContactForm,
      hasHeroSection,
      hasCta,
      isHttps,
      copyrightYear,
      yearsStale,
      builderSubdomain,
      brokenContactLinks: brokenLinks,
      scriptCount,
      stylesheetCount,
      htmlSizeBytes,
    },
  }
}
