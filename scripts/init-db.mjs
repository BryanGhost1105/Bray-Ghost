import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to initialize the database.');
}

const pool = new Pool({ connectionString });

async function initDb() {
  try {
    console.log("Connecting to Neon Postgres...");
    
    await pool.query(`
      create table if not exists niches (
        id uuid primary key default gen_random_uuid(),
        label text not null,
        city text not null,
        status text not null default 'active',
        source text not null default 'seed',
        reasoning text,
        created_at timestamptz not null default now()
      );

      create table if not exists leads (
        id uuid primary key default gen_random_uuid(),
        niche_id uuid references niches(id),
        business_name text not null,
        address text,
        website text,
        email text,
        email_source text,
        email_confidence text,
        email_source_url text,
        phone text,
        place_id text unique,
        status text not null default 'new',
        seo_score int,
        seo_flags text,
        scraped_content text,
        generated_subject text,
        generated_body text,
        initial_approval_status text not null default 'pending',
        initial_approved_at timestamptz,
        initial_approved_by text,
        followup_approval_status text not null default 'pending',
        followup_approved_at timestamptz,
        followup_approved_by text,
        initial_sent_at timestamptz,
        initial_opened_at timestamptz,
        initial_provider_id text,
        followup_subject text,
        followup_body text,
        followup_sent_at timestamptz,
        followup_opened_at timestamptz,
        followup_provider_id text,
        bounced_at timestamptz,
        replied_at timestamptz,
        unsubscribed_at timestamptz,
        unsubscribe_token text default gen_random_uuid()::text,
        next_attempt_at timestamptz,
        email_attempts int not null default 0,
        email_last_attempt_at timestamptz,
        email_last_error text,
        send_claimed_at timestamptz,
        followup_claimed_at timestamptz,
        send_attempts int not null default 0,
        followup_attempts int not null default 0,
        followup_next_attempt_at timestamptz,
        send_last_error text,
        created_at timestamptz not null default now()
      );

      create table if not exists settings (
        id int primary key default 1,
        daily_cap int not null default 100,
        paused boolean not null default false,
        last_run_at timestamptz,
        places_used_date date,
        places_used_count int not null default 0,
        constraint single_row check (id = 1)
      );

      create table if not exists suppressed_emails (
        email text primary key,
        reason text not null default 'bounce',
        created_at timestamptz not null default now()
      );

      create table if not exists suppressed_places (
        place_id text primary key,
        created_at timestamptz not null default now()
      );

      create table if not exists errors (
        id uuid primary key default gen_random_uuid(),
        source text not null,
        stage text not null,
        message text not null,
        context jsonb,
        created_at timestamptz not null default now()
      );

      create index if not exists errors_created_at_idx on errors (created_at desc);
      create index if not exists idx_leads_send_queue on leads(status, next_attempt_at, send_claimed_at);
      create index if not exists idx_leads_followup_queue on leads(status, followup_sent_at, followup_claimed_at);
      create index if not exists idx_leads_unsubscribe_token on leads(unsubscribe_token);

      insert into settings (id, daily_cap, paused) values (1, 100, false) on conflict (id) do nothing;
    `);

    const nicheCheck = await pool.query(`select count(*) from niches`);
    if (parseInt(nicheCheck.rows[0].count, 10) === 0) {
      await pool.query(`
        insert into niches (label, city, status, source) values
          ('garage door repair', 'Dallas, TX', 'active', 'seed'),
          ('garage door repair', 'Austin, TX', 'active', 'seed'),
          ('garage door repair', 'Miami, FL', 'active', 'seed'),
          ('chiropractor', 'Dallas, TX', 'active', 'seed'),
          ('chiropractor', 'Austin, TX', 'active', 'seed'),
          ('chiropractor', 'Miami, FL', 'active', 'seed'),
          ('roofing contractor', 'Dallas, TX', 'active', 'seed'),
          ('roofing contractor', 'Austin, TX', 'active', 'seed'),
          ('roofing contractor', 'Miami, FL', 'active', 'seed');
      `);
      console.log("Seeded 9 initial niches!");
    } else {
      console.log(`Niches table already contains ${nicheCheck.rows[0].count} rows.`);
    }

    console.log("Database schema initialized successfully!");
  } catch (err) {
    console.error("Database initialization failed:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

initDb();
