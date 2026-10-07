import { NextResponse } from 'next/server'
import { requireCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'

// Google Places-derived business content is generally not eligible for CRM
// retention. Keep scheduled discovery disabled until this endpoint is replaced
// with a source and persistence model approved for the intended use.
export async function GET(request: Request) {
  const authError = requireCronAuth(request)
  if (authError) return authError

  return NextResponse.json({
    success: true,
    skipped: 'source_retention_review_required',
    message: 'Automated discovery is paused until an approved lead source is configured.',
  })
}
