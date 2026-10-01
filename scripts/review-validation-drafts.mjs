import { Pool } from '@neondatabase/serverless'
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')

const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 30000 })
try {
  const result = await pool.query(`
    SELECT l.business_name, l.email, l.opportunity_score, l.outreach_angle,
           l.generated_subject, l.generated_body, l.audit_details->'verifiedFacts' AS verified_facts
    FROM leads l
    JOIN niches n ON n.id = l.niche_id
    WHERE lower(n.label) = lower('Solar Installer')
      AND lower(n.city) = lower('Port Harcourt, Nigeria')
      AND l.generated_body IS NOT NULL
    ORDER BY l.opportunity_score DESC NULLS LAST
  `)
  console.log(JSON.stringify(result.rows, null, 2))
} finally {
  await pool.end()
}
