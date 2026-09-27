import fs from 'node:fs'

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const index = line.indexOf('=')
      return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')]
    })
)

const leadId = process.argv[2]
if (!leadId) throw new Error('Usage: node scripts/smoke-regenerate.mjs <leadId>')

const response = await fetch('http://localhost:3000/api/leads', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${env.APP_ACCESS_TOKEN}`,
    Origin: 'http://localhost:3000',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ action: 'regenerate', leadId }),
})

const body = await response.json()
console.log(JSON.stringify({
  status: response.status,
  success: body.success,
  message: body.message || body.error,
  draft: body.lead && {
    subject: body.lead.generated_subject,
    body: body.lead.generated_body,
    approval: body.lead.initial_approval_status,
    policy: body.lead.generation_policy_version,
  },
}, null, 2))
