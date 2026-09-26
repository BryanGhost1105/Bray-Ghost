import pg from 'pg'

const { Pool } = pg
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
try {
  const result = await pool.query(`
    SELECT l.business_name, l.status, l.email, l.email_confidence,
           l.opportunity_score, l.outreach_angle, l.last_audited_at,
           l.initial_approval_status, l.audit_details->'verifiedFacts' AS verified_facts
    FROM leads l
    JOIN niches n ON n.id = l.niche_id
    WHERE lower(n.label) = lower('Solar Installer')
      AND lower(n.city) = lower('Port Harcourt, Nigeria')
    ORDER BY l.created_at ASC
  `)
  console.log(JSON.stringify(result.rows, null, 2))
} finally {
  await pool.end()
}
