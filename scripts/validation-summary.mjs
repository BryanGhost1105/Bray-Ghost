import { Pool } from '@neondatabase/serverless'
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const businessFilter = process.argv[2] || null
try {
  const result = await pool.query(`
    SELECT l.id, l.business_name, l.status, l.email, l.email_confidence,
           l.email_source, l.email_source_url, l.email_verification_status,
           l.opportunity_score, l.outreach_angle, l.last_audited_at,
           l.initial_approval_status, l.audit_attempts, l.audit_next_attempt_at,
           l.audit_details->'verifiedFacts' AS verified_facts
    FROM leads l
    JOIN niches n ON n.id = l.niche_id
    WHERE lower(n.label) = lower('Solar Installer')
      AND lower(n.city) = lower('Port Harcourt, Nigeria')
      AND ($1::text IS NULL OR lower(l.business_name) = lower($1))
    ORDER BY l.created_at ASC
  `, [businessFilter])
  const interactionResult = await pool.query(`
    SELECT outcome, COUNT(*)::int AS count
    FROM lead_interactions
    GROUP BY outcome
    ORDER BY outcome
  `)
  console.log(JSON.stringify({ leads: result.rows, interactions: interactionResult.rows }, null, 2))
} finally {
  await pool.end()
}
