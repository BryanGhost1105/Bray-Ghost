import fs from 'node:fs'
import { Pool } from '@neondatabase/serverless'
const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]
    })
)

if (!env.DATABASE_URL || !env.APP_ACCESS_TOKEN) throw new Error('DATABASE_URL and APP_ACCESS_TOKEN are required in .env.local')

const pool = new Pool({ connectionString: env.DATABASE_URL, connectionTimeoutMillis: 10000, query_timeout: 30000 })
const baseUrl = process.argv[2] || 'http://localhost:3000'

try {
  const result = await pool.query(`
    SELECT l.id, l.business_name
    FROM leads l
    JOIN niches n ON n.id = l.niche_id
    WHERE lower(n.label) = lower('Solar Installer')
      AND lower(n.city) = lower('Port Harcourt, Nigeria')
      AND (
        (l.status = 'new' AND l.last_audited_at IS NULL)
        OR l.scraped_content LIKE '%(Audit attempt failed:%'
      )
    ORDER BY l.created_at ASC
  `)

  const results = []
  for (const lead of result.rows) {
    const response = await fetch(`${baseUrl}/api/leads`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.APP_ACCESS_TOKEN}`,
        Origin: baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'reaudit', leadId: lead.id }),
    })
    const body = await response.json().catch(() => ({}))
    results.push({
      business: lead.business_name,
      status: response.status,
      success: response.ok && body.success === true && body.scrapedOk === true,
      scrapedOk: body.scrapedOk,
      generatedOk: body.generatedOk,
      leadStatus: body.lead?.status,
      auditedAt: body.lead?.last_audited_at,
      auditError: body.lead?.scraped_content?.match(/\(Audit attempt failed: ([^)]+)\)/)?.[1],
      message: body.message || body.error,
    })
  }

  const failed = results.filter((item) => !item.success).length
  console.log(JSON.stringify({ audited: results.length, failed, results }, null, 2))
  if (failed > 0) process.exitCode = 1
} finally {
  await pool.end()
}
