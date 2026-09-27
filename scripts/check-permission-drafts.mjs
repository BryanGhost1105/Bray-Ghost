import pg from 'pg'

const { Pool } = pg
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')

const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 30000 })
const permissionRequest = /\b(can i|may i|should i|would it be useful|mind if|is it okay|okay if)\b/i
const unsupportedClaim = /\b(guarantee|guaranteed|double your|triple your|more leads|lost leads|increase revenue|rank #?1|number one on google|significantly|boost|improve|enhance|capture more|more customers|more clients|more inquiries|local search ranking|show up effectively|potential clients|prepared|put together|attached|one-page|audit|book a call|schedule a call)\b/i

try {
  const result = await pool.query(`
    SELECT l.business_name, l.generated_subject, l.generated_body,
           l.generation_policy_version
    FROM leads l
    JOIN niches n ON n.id = l.niche_id
    WHERE lower(n.label) = lower('Solar Installer')
      AND lower(n.city) = lower('Port Harcourt, Nigeria')
      AND l.generated_body IS NOT NULL
    ORDER BY l.created_at ASC
  `)

  const checks = result.rows.map((row) => {
    const text = `${row.generated_subject || ''}\n${row.generated_body || ''}`
    return {
      business: row.business_name,
      policy: row.generation_policy_version,
      permissionRequest: permissionRequest.test(text),
      unsupportedClaim: unsupportedClaim.test(text),
    }
  })
  const passed = checks.filter((item) => item.policy === 'permission-v1' && item.permissionRequest && !item.unsupportedClaim)
  console.log(JSON.stringify({ checked: checks.length, passed: passed.length, failed: checks.filter((item) => !passed.includes(item)), checks }, null, 2))
  if (passed.length !== checks.length) process.exitCode = 1
} finally {
  await pool.end()
}
