import { Pool } from '@neondatabase/serverless'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.')
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const client = await pool.connect()

try {
  await client.query('BEGIN')
  await client.query(`
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS initial_approval_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS initial_approved_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS initial_approved_by TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS send_uncertain_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_approval_status TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_approved_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_approved_by TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_uncertain_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS generation_policy_version TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_verification_status TEXT NOT NULL DEFAULT 'unverified';
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP WITH TIME ZONE;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_verification_method TEXT;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS audit_attempts INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE leads ADD COLUMN IF NOT EXISTS audit_next_attempt_at TIMESTAMP WITH TIME ZONE;
    UPDATE leads
    SET email_verification_status = CASE
          WHEN email IS NOT NULL AND email_confidence = 'HIGH' AND email_source_url IS NOT NULL AND email_source IS DISTINCT FROM 'ai_extracted' THEN 'source_verified'
          WHEN email IS NOT NULL THEN 'needs_review'
          ELSE 'unverified'
        END,
        email_verified_at = CASE
          WHEN email IS NOT NULL AND email_confidence = 'HIGH' AND email_source_url IS NOT NULL AND email_source IS DISTINCT FROM 'ai_extracted' THEN COALESCE(email_verified_at, NOW())
          ELSE NULL
        END,
        email_verification_method = CASE
          WHEN email IS NOT NULL AND email_confidence = 'HIGH' AND email_source_url IS NOT NULL AND email_source IS DISTINCT FROM 'ai_extracted' THEN COALESCE(email_verification_method, 'source-confidence-check')
          ELSE NULL
        END
    WHERE email_verification_status = 'unverified'
       OR (email_verification_status = 'source_verified' AND email_source = 'ai_extracted');
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
  await client.query('COMMIT')
  console.log('Approval schema migration committed.')
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  client.release()
  await pool.end()
}
