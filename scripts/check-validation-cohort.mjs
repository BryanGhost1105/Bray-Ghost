import pg from 'pg'

const { Pool } = pg
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 10000,
  query_timeout: 30000,
})

try {
  const result = await pool.query(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE l.status = 'new')::int AS new_leads,
      COUNT(*) FILTER (WHERE l.email IS NULL)::int AS without_email,
      COUNT(*) FILTER (WHERE l.email_verification_status = 'source_verified')::int AS source_verified,
      COUNT(*) FILTER (WHERE l.email_verification_status = 'needs_review')::int AS needs_review,
      COUNT(*) FILTER (WHERE l.email_verification_status IS NULL OR l.email_verification_status = 'unverified')::int AS unverified,
      COUNT(*) FILTER (WHERE l.initial_approval_status <> 'pending' OR l.followup_approval_status <> 'pending')::int AS non_pending_approvals,
      COUNT(*) FILTER (WHERE l.initial_approval_status = 'approved' AND l.email_verification_status <> 'source_verified')::int AS approved_without_verification,
      COUNT(*) FILTER (WHERE l.initial_sent_at IS NOT NULL OR l.followup_sent_at IS NOT NULL)::int AS sent,
      COUNT(*) FILTER (WHERE l.last_audited_at IS NOT NULL)::int AS audited
    FROM leads l
    JOIN niches n ON n.id = l.niche_id
    WHERE lower(n.label) = lower('Solar Installer')
      AND lower(n.city) = lower('Port Harcourt, Nigeria')
  `)

  const summary = result.rows[0]
  const violations = []
  if (Number(summary.total) < 20) violations.push(`expected at least 20 leads, found ${summary.total}`)
  if (Number(summary.non_pending_approvals) !== 0) violations.push('one or more cohort leads have a non-pending approval')
  if (Number(summary.approved_without_verification) !== 0) violations.push('one or more approved leads lack source verification')
  if (Number(summary.sent) !== 0) violations.push('one or more cohort leads have been sent')

  if (violations.length) {
    console.error(JSON.stringify({ summary, violations }, null, 2))
    process.exit(1)
  }

  console.log(JSON.stringify({ summary, safety: 'passed' }, null, 2))
} finally {
  await pool.end()
}
