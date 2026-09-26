import { Pool, neonConfig } from '@neondatabase/serverless'
import { attachDatabasePool } from '@vercel/functions'

neonConfig.webSocketConstructor = WebSocket

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
})

// Handle idle connection drops gracefully
pool.on('error', (err: unknown) => {
  console.warn('Database pool idle connection notice:', err instanceof Error ? err.message : String(err))
})

// Lets Vercel's runtime close idle connections cleanly between invocations
if (process.env.VERCEL) {
  try {
    attachDatabasePool(pool)
  } catch {
    // Ignore in non-Vercel environments
  }
}

let schemaEnsured = false

export async function ensureSchema(): Promise<void> {
  if (schemaEnsured) return

  try {
    await pool.query(`
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS mobile_score INTEGER;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS performance_score INTEGER;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS design_score INTEGER;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS ux_score INTEGER;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS technical_score INTEGER;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS opportunity_score INTEGER;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS audit_details JSONB;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_angle TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS outreach_reason TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_source TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_confidence TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_source_url TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_audited_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS replied_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS initial_provider_id TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_provider_id TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS unsubscribe_token TEXT DEFAULT gen_random_uuid()::text;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_last_attempt_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS email_last_error TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS send_claimed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS send_uncertain_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_claimed_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_uncertain_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS send_attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_attempts INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_next_attempt_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS send_last_error TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS initial_approval_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS initial_approved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS initial_approved_by TEXT;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_approval_status TEXT NOT NULL DEFAULT 'pending';
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_approved_at TIMESTAMP WITH TIME ZONE;
      ALTER TABLE leads ADD COLUMN IF NOT EXISTS followup_approved_by TEXT;
      ALTER TABLE settings ADD COLUMN IF NOT EXISTS replies_count INTEGER DEFAULT 0;
      UPDATE leads SET unsubscribe_token = gen_random_uuid()::text WHERE unsubscribe_token IS NULL;

      CREATE TABLE IF NOT EXISTS lead_contacts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        email_type TEXT DEFAULT 'general',
        source TEXT,
        confidence TEXT DEFAULT 'HIGH',
        source_url TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_lead_contacts_lead_id ON lead_contacts(lead_id);
      CREATE INDEX IF NOT EXISTS idx_leads_opportunity_score ON leads(opportunity_score);
      CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
      CREATE INDEX IF NOT EXISTS idx_leads_send_queue ON leads(status, next_attempt_at, send_claimed_at);
      CREATE INDEX IF NOT EXISTS idx_leads_followup_queue ON leads(status, followup_sent_at, followup_claimed_at);
      CREATE INDEX IF NOT EXISTS idx_leads_unsubscribe_token ON leads(unsubscribe_token);
    `)
    schemaEnsured = true
  } catch (err: unknown) {
    console.error('Database schema migration failed:', err instanceof Error ? err.message : String(err))
    throw err
  }
}

export async function queryWithRetry<T = unknown>(
  text: string,
  params?: unknown[],
  maxRetries = 2
): Promise<{ rows: T[]; rowCount?: number | null }> {
  let attempt = 0
  while (attempt <= maxRetries) {
    try {
      const res = await pool.query(text, params)
      return { rows: res.rows as T[], rowCount: res.rowCount }
    } catch (err: unknown) {
      attempt++
      if (attempt > maxRetries) {
        throw err
      }
      await new Promise((r) => setTimeout(r, attempt * 500))
    }
  }
  throw new Error('Database query retry failed')
}
