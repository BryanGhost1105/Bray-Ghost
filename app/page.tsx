import { queryWithRetry, ensureSchema } from '@/lib/db'
import { DEFAULT_INDUSTRIES, DEFAULT_CITIES, MAX_DAILY_CAP } from '@/lib/constants'
import DashboardClient, { type ErrorRecord, type Lead, type Niche, type Settings } from '@/components/DashboardClient'
import { hasInternalSession } from '@/lib/internalAuth'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function Page() {
  if (!(await hasInternalSession())) redirect('/login')

  // Ensure new columns / tables exist before querying
  await ensureSchema()

  let settings: Settings = {
    daily_cap: MAX_DAILY_CAP,
    paused: false,
    last_run_at: null,
    gmail_user: null,
    replies_count: 0,
  }

  let niches: Niche[] = []
  let leads: Lead[] = []
  let errors: ErrorRecord[] = []
  let stats = {
    total: 0,
    sent_total: 0,
    replies_total: 0,
    sent_today: 0,
    audited_total: 0,
    ready_to_contact: 0,
    avg_opportunity: 0,
    avg_seo: 0,
    avg_mobile: 0,
  }
  let statusCounts: Record<string, number> = {}

  try {
    const [
      settingsRes,
      nichesRes,
      leadsRes,
      statsRes,
      statusCountsRes,
      errorsRes,
    ] = await Promise.all([
      queryWithRetry<Settings>('select * from settings where id = 1'),

      queryWithRetry<Niche>(
        'select * from niches order by created_at desc'
      ),

      queryWithRetry<Lead>(
        `select id, niche_id, business_name, address, website, email, place_id,
                status, seo_score, seo_flags, scraped_content, generated_subject,
                generated_body, followup_subject, followup_body,
                initial_approval_status, initial_approved_at, initial_approved_by,
                followup_approval_status, followup_approved_at, followup_approved_by,
                initial_sent_at, initial_opened_at, followup_sent_at, followup_opened_at,
                replied_at, created_at, mobile_score, performance_score, design_score, ux_score,
                technical_score, opportunity_score, outreach_angle, outreach_reason,
                email_confidence, email_source, email_source_url, phone, audit_details, last_audited_at
         from leads order by opportunity_score desc nulls last, seo_score asc nulls last, created_at desc`
      ),

      queryWithRetry<Record<string, unknown>>(`
        select
          coalesce(count(*), 0) as total,
          coalesce(
            sum(
              case
                when initial_sent_at is not null or followup_sent_at is not null
                then 1
                else 0
              end
            ),
            0
          ) as sent_total,
          coalesce(
            sum(
              case
                when replied_at is not null
                then 1
                else 0
              end
            ),
            0
          ) as replies_total,
          coalesce(
            sum(
              case
                when initial_sent_at >= current_date
                  or followup_sent_at >= current_date
                then 1
                else 0
              end
            ),
            0
          ) as sent_today,
          coalesce(
            sum(
              case when last_audited_at is not null then 1 else 0 end
            ),
            0
          ) as audited_total,
          coalesce(
            sum(
              case when status = 'scraped' and email is not null then 1 else 0 end
            ),
            0
          ) as ready_to_contact,
          coalesce(round(avg(opportunity_score) filter (where opportunity_score is not null)), 0) as avg_opportunity,
          coalesce(round(avg(seo_score) filter (where seo_score is not null)), 0) as avg_seo,
          coalesce(round(avg(mobile_score) filter (where mobile_score is not null)), 0) as avg_mobile
        from leads
      `),

      queryWithRetry<{ status: string; count: number }>(
        'select status, count(*)::int as count from leads group by status'
      ),

      queryWithRetry<ErrorRecord>(
        'select * from errors order by created_at desc limit 200'
      ),
    ])

    settings = settingsRes.rows[0] || settings
    niches = nichesRes.rows
    leads = leadsRes.rows
    errors = errorsRes.rows

    const rawStats = statsRes.rows[0] || {
      total: 0,
      sent_total: 0,
      replies_total: 0,
      sent_today: 0,
      audited_total: 0,
      ready_to_contact: 0,
      avg_opportunity: 0,
      avg_seo: 0,
      avg_mobile: 0,
    }

    const manualReplies = Number(settings.replies_count) || 0
    const leadReplies = Number(rawStats.replies_total) || 0

    stats = {
      total: Number(rawStats.total) || 0,
      sent_total: Number(rawStats.sent_total) || 0,
      replies_total: Math.max(manualReplies, leadReplies),
      sent_today: Number(rawStats.sent_today) || 0,
      audited_total: Number(rawStats.audited_total) || 0,
      ready_to_contact: Number(rawStats.ready_to_contact) || 0,
      avg_opportunity: Number(rawStats.avg_opportunity) || 0,
      avg_seo: Number(rawStats.avg_seo) || 0,
      avg_mobile: Number(rawStats.avg_mobile) || 0,
    }

    statusCounts = statusCountsRes.rows.reduce(
      (acc, row) => {
        acc[row.status] = Number(row.count) || 0
        return acc
      },
      {} as Record<string, number>
    )
  } catch (err: unknown) {
    const errorMsg =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null && 'message' in err
        ? String((err as Record<string, unknown>).message)
        : typeof err === 'object' && err !== null && 'error' in err
        ? String((err as Record<string, unknown>).error)
        : JSON.stringify(err)
    console.warn('Dashboard query status:', errorMsg)
  }

  return (
    <DashboardClient
      initialSettings={settings}
      initialNiches={niches}
      initialLeads={leads}
      initialErrors={errors}
      stats={stats}
      statusCounts={statusCounts}
      defaultIndustries={DEFAULT_INDUSTRIES}
      defaultCities={DEFAULT_CITIES}
    />
  )
}
