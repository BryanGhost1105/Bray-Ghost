import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.')
}

const expected = [
  'initial_approval_status',
  'initial_approved_at',
  'initial_approved_by',
  'followup_approval_status',
  'followup_approved_at',
  'followup_approved_by',
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

  console.log(JSON.stringify({ found, missing }, null, 2))
  if (missing.length > 0) process.exitCode = 1
} finally {
  await pool.end()
}
