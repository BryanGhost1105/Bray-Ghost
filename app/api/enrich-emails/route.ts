import { NextResponse } from 'next/server'
import { enrichLeadEmail, enrichAllPendingLeads } from '@/lib/emailScraperEngine'
import { ensureSchema } from '@/lib/db'
import { requireInternalWriteAuth } from '@/lib/internalAuth'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const authError = requireInternalWriteAuth(request)
  if (authError) return authError
  await ensureSchema()

  try {
    const body = await request.json().catch(() => ({}))
    const { action, leadId, limit } = body

    if (action === 'enrich_single') {
      if (!leadId) {
        return NextResponse.json({ success: false, error: 'leadId is required.' }, { status: 400 })
      }

      const result = await enrichLeadEmail(leadId)
      return NextResponse.json({
        success: true,
        result,
        message: result.email
          ? `Found email: ${result.email} (${result.emailConfidence} confidence)`
          : 'No email found for this business.',
      })
    }

    // Default: enrich all leads lacking emails
    const batchLimit = typeof limit === 'number' ? Math.min(limit, 100) : 50
    const result = await enrichAllPendingLeads(batchLimit)

    return NextResponse.json({
      success: true,
      totalProcessed: result.totalProcessed,
      enrichedCount: result.enrichedCount,
      results: result.results,
      message: `Found source-linked contact candidates for ${result.enrichedCount} of ${result.totalProcessed} pending leads. Mailbox delivery was not checked.`,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
