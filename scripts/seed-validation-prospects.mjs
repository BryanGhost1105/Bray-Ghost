import pg from 'pg'

const { Pool } = pg

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required.')
}

const prospects = [
  { business: 'Solartricity', website: 'https://www.solartricity.com.ng/' },
  { business: 'Sombreiro Energy Limited', website: 'https://sombreiroenergy.com/' },
  { business: 'Toyah Energies Limited', website: 'https://toyahenergies.com/' },
  { business: 'Solar World Electric Technology', website: 'https://www.solarworldelectric.com/' },
  { business: 'Dayli Energy Solutions', website: 'https://www.daylienergy.com/' },
  { business: 'GoSolar Ng', website: 'https://www.gosolar.ng/' },
  { business: 'Khariz Energy', website: 'https://kharizenergy.com/' },
  { business: 'TECIL Solar', website: 'https://www.tecilsolar.com/' },
  { business: 'Rafrank Integrated Limited', website: 'https://rafrankltd.com/solar.php' },
  { business: 'Goshenvilla Limited', website: 'https://goshenvilla.com/' },
  { business: 'HakunaSolar', website: 'https://hakunasolar.com/' },
  { business: 'SolarBolts', website: 'https://solarbolts.com/' },
  { business: 'DB Energy', website: 'https://www.dbenergy.ng/locations/port-harcourt' },
  { business: 'Marrot Energy', website: 'https://marrotenergy.com/' },
  { business: 'PET FEB International', website: 'https://petfeb.com/' },
  { business: 'SprintQuest Energy Services', website: null },
  { business: 'Unitronix Global', website: null },
  { business: 'ECAFGOLDEN SOLAR', website: 'https://www.ecafgoldensolar.com.ng/' },
  { business: 'EnergyCare', website: null },
  { business: 'Solution Energy and Engineering Services', website: 'https://www.solutionenergylimited.com/' },
  { business: 'Flowcrown Technologies', website: 'https://flowcrown.com/' },
  { business: 'Ibis Technologies', website: 'https://ibistechnologies.com.ng/' },
  { business: 'Felson Solar Solutions', website: 'https://www.felsonsolar.com/' },
  { business: 'Almond Solutions', website: 'https://www.almondsolutions.com.ng/' },
  { business: 'Francostech Limited', website: 'https://francostech.com/' },
  { business: 'Reverse Energy', website: 'https://reverseenergy.ng/' },
  { business: 'Nyesco Energy Service', website: 'https://www.nyescoenergy.com/' },
  { business: 'Enerplaz PayGo', website: 'https://enerplazpaygo.com/' },
  { business: 'Tovero Energy', website: 'http://www.toveroenergy.com/' },
  { business: 'A.O. Demarg', website: 'https://aodemarg.com/' },
]

const pool = new Pool({ connectionString: process.env.DATABASE_URL })

try {
  await pool.query('BEGIN')
  const niche = await pool.query(
    `INSERT INTO niches (label, city, status, source, reasoning)
     SELECT 'Solar Installer', 'Port Harcourt, Nigeria', 'active', 'validation', 'First commercial validation cohort for the Coldstart rebuild.'
     WHERE NOT EXISTS (
       SELECT 1 FROM niches WHERE lower(label) = lower('Solar Installer') AND lower(city) = lower('Port Harcourt, Nigeria')
     )
     RETURNING id`
  )

  let nicheId = niche.rows[0]?.id
  if (!nicheId) {
    const existing = await pool.query(
      `SELECT id FROM niches WHERE lower(label) = lower('Solar Installer') AND lower(city) = lower('Port Harcourt, Nigeria') LIMIT 1`
    )
    nicheId = existing.rows[0]?.id
  }

  if (!nicheId) throw new Error('Could not create or find the validation niche.')

  let inserted = 0
  for (const prospect of prospects) {
    const result = await pool.query(
      `INSERT INTO leads (niche_id, business_name, address, website, status, initial_approval_status, followup_approval_status)
       SELECT $1, $2, $3, $4, 'new', 'pending', 'pending'
       WHERE NOT EXISTS (
         SELECT 1 FROM leads WHERE lower(business_name) = lower($2) AND website IS NOT DISTINCT FROM $4
       )
       RETURNING id, business_name`,
      [nicheId, prospect.business, 'Port Harcourt, Nigeria', prospect.website]
    )
    if (result.rows[0]) inserted++
  }

  await pool.query('COMMIT')
  console.log(JSON.stringify({ nicheId, inserted, totalCandidates: prospects.length }))
} catch (error) {
  await pool.query('ROLLBACK').catch(() => undefined)
  throw error
} finally {
  await pool.end()
}
