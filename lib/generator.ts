import { pool } from './db'
import { isSuppressedEmail } from './suppression'
import { callDeepSeekJson, parseEmailResponse } from './ai'

interface AuditIssue {
  title: string
  detail: string
}

interface AuditDetails {
  verifiedFacts?: string[]
  topIssues?: AuditIssue[]
  quickWins?: string[]
}

interface LeadForGeneration {
  id: string
  business_name: string
  website: string | null
  email: string | null
  scraped_content: string | null
  outreach_angle: string | null
  outreach_reason: string | null
  mobile_score: number | null
  seo_score: number | null
  design_score: number | null
  performance_score: number | null
  ux_score: number | null
  opportunity_score: number | null
  audit_details: AuditDetails | null
}

export async function generateEmail(leadId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT
       id, business_name, website, email, scraped_content,
       outreach_angle, outreach_reason, mobile_score, seo_score,
       design_score, performance_score, ux_score, opportunity_score,
       audit_details
     FROM leads WHERE id = $1`,
    [leadId]
  )

  if (result.rows.length === 0) {
    return false
  }

  const lead: LeadForGeneration = result.rows[0]

  if (!lead.email || lead.email.trim() === '') {
    // Cannot generate email without recipient; mark as email_needed without deleting
    await pool.query(`UPDATE leads SET status = 'email_needed' WHERE id = $1`, [leadId])
    return false
  }

  // Check if suppressed
  if (await isSuppressedEmail(lead.email)) {
    await pool.query(`UPDATE leads SET status = 'failed' WHERE id = $1`, [leadId])
    return false
  }

  const hasWebsite = Boolean(lead.website && lead.website.trim() !== '')
  const businessName = lead.business_name || 'Business Owner'
  const primaryAngle = lead.outreach_angle || 'seo'
  const outreachReason = lead.outreach_reason || 'Identified opportunities to improve search visibility and mobile conversions.'

  let verifiedFactsSummary = ''
  let topIssuesSummary = ''
  let quickWinsSummary = ''

  if (lead.audit_details && typeof lead.audit_details === 'object') {
    const verifiedFacts = Array.isArray(lead.audit_details.verifiedFacts)
      ? lead.audit_details.verifiedFacts.map((f: string) => `- ${f}`).join('\n')
      : ''
    if (verifiedFacts) {
      verifiedFactsSummary = `\nVerified Measured Facts (Cite exactly if mentioning these):\n${verifiedFacts}`
    }

    const issues = Array.isArray(lead.audit_details.topIssues)
      ? lead.audit_details.topIssues.map((i: AuditIssue) => `- ${i.title}: ${i.detail}`).join('\n')
      : ''
    const wins = Array.isArray(lead.audit_details.quickWins)
      ? lead.audit_details.quickWins.map((w: string) => `- ${w}`).join('\n')
      : ''
    if (issues) topIssuesSummary = `\nDetected Real Issues:\n${issues}`
    if (wins) quickWinsSummary = `\nPotential Quick Wins:\n${wins}`
  }

  const angleGuidelines: Record<string, string> = {
    mobile: `Focus on the website's smartphone user experience. If there is a missing tap-to-call link or viewport issue, mention it plainly as a quick fix to make calling and browsing effortless for customers on phones.`,
    conversion: `Focus on quote requests and lead capture. If a contact link is broken, or if there is no quick estimate/quote form, mention that fixing this friction point helps turn web visitors into paying jobs.`,
    design: `Focus on visual trust and credibility. If the footer copyright date is years out of date, or if they are running on a builder subdomain, or lack a clear hero call-to-action, mention it naturally as a clean modernization opportunity.`,
    seo: `Focus on Google local search presence. Mention missing LocalBusiness schema markup, meta description, or title tag that helps them rank properly against local competitors.`,
    performance: `Focus on fast page loading for mobile customers. If a real PageSpeed score or load time is listed in Verified Measured Facts, cite that exact number verbatim.`,
  }

  const selectedGuideline = hasWebsite
    ? angleGuidelines[primaryAngle] || angleGuidelines.seo
    : `The business currently has NO website. Pitch building a clean, modern, mobile-friendly website from scratch to start capturing local online leads and calls.`

  const senderName = process.env.SENDER_NAME || 'Bryan Allen'

  const systemPrompt = `You are ${senderName}, an independent freelance web developer reaching out to local business owners. Write a short, highly personalized cold email.

Strict Tone & Style Rules:
1. NO em dashes (—) anywhere in the text. Use standard commas or periods.
2. NO corporate filler phrases ("I hope this email finds you well", "I'm reaching out because", "just wanted to circle back", "in today's digital landscape", etc.).
3. NO generic marketing hype or parallel-triplet phrasing ("fast, reliable, and affordable").
4. STRICT ZERO-HALLUCINATION & FACT GROUNDING RULE:
   - NEVER invent, estimate, or assume numbers, speed times, or fake traffic statistics.
   - If you cite a speed or metric (e.g. load time, PageSpeed score, copyright year), you MUST cite the exact number provided in 'Verified Measured Facts' verbatim.
   - If no specific measured number is listed for a point, describe the observed technical issue factually without fabricating numbers.
5. Opening line: Start with a natural, genuine observation about their website or local presence.
6. Length: Exactly 3 to 5 clear, human sentences.
7. Sign off naturally with "${senderName.split(' ')[0]}" or "${senderName}".
8. Reads like a real web developer took two minutes to look at their site and typed a note by hand.
9. Return STRICT JSON only in this exact format, with no other text, markdown fences, or explanation:
{
  "subject": "string",
  "body": "string"
}

Target Context:
- Business Name: ${businessName}
- Website: ${lead.website || 'None'}
- Selected Outreach Angle: ${primaryAngle.toUpperCase()} (${outreachReason})
- Angle Instruction: ${selectedGuideline}
${verifiedFactsSummary}
${topIssuesSummary}
${quickWinsSummary}
`

  const emailData = await callDeepSeekJson(
    systemPrompt,
    `Write the personalized outreach email for ${businessName}.`,
    parseEmailResponse
  )

  await pool.query(
    `UPDATE leads SET
       generated_subject = $1,
       generated_body = $2,
       status = 'generated'
     WHERE id = $3`,
    [emailData.subject, emailData.body, leadId]
  )

  return true
}
