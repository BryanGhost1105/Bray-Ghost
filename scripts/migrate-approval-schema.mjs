import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.')
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

try {
  await pool.query('BEGIN')
  await pool.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS initial_approval_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS initial_approved_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS initial_approved_by TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS send_uncertain_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_approval_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_approved_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_approved_by TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_uncertain_at TIMESTAMP WITH TIME ZONE;
    CREATE TABLE IF NOT EXISTS lead_interactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      channel TEXT NOT NULL,
      outcome TEXT NOT NULL,
      note TEXT,
      occurred_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      next_action_at TIMESTAMP WITH TIME ZONE,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_lead_interactions_lead_id
      ON lead_interactions(lead_id, occurred_at DESC);
  `)
  await pool.query('COMMIT')
  console.log('Approval schema migration committed.')
} catch (error) {
  await pool.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await pool.end()
}
