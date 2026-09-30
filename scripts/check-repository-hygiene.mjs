import { execFileSync } from 'node:child_process'

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

const forbiddenName = /(^|\/)(\.env(?:\.|$)|.*\.(?:pem|key))|(^|\/)(?:credentials?|secrets?)(?:\.(?:json|ya?ml|txt|csv)|\/|$)/i
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:postgres(?:ql)?|mysql):\/\/[^\s:@]+:[^\s@]+@/i,
  /\b(?:AIza[0-9A-Za-z_-]{20,}|ghp_[0-9A-Za-z]{20,}|github_pat_[0-9A-Za-z_]{20,}|sk-[A-Za-z0-9]{20,})/,
]

const nameViolations = tracked.filter((file) => forbiddenName.test(file))
const contentViolations = []

for (const file of tracked) {
  if (file === 'package-lock.json' || file === 'npm-shrinkwrap.json') continue
  const text = execFileSync('git', ['show', `HEAD:${file}`], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  if (secretPatterns.some((pattern) => pattern.test(text))) contentViolations.push(file)
}

if (nameViolations.length || contentViolations.length) {
  console.error(JSON.stringify({ nameViolations, contentViolations }, null, 2))
  process.exit(1)
}

console.log(`Repository hygiene passed: ${tracked.length} tracked files scanned; no credential filenames or common secret patterns found.`)
