import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.')
}

const expected = [
  'initial_approval_status',
  'initial_approved_at',
  'initial_approved_by',
  'send_uncertain_at',
  'followup_approval_status',
  'followup_approved_at',
  'followup_approved_by',
  'followup_uncertain_at',
  'generation_policy_version',
]

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

try {
  const result = await pool.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_name = 'leads'
       AND column_name = ANY($1::text[])
     ORDER BY column_name`,
    [expected]
  )

  const found = result.rows.map((row) => row.column_name)
  const missing = expected.filter((column) => !found.includes(column))

  const interactionTable = await pool.query(
    `SELECT to_regclass('public.lead_interactions') IS NOT NULL AS present`
  )

  console.log(JSON.stringify({ found, missing, leadInteractionsTable: Boolean(interactionTable.rows[0]?.present) }, null, 2))
  if (missing.length > 0 || !interactionTable.rows[0]?.present) process.exitCode = 1
} finally {
  await pool.end()
}
