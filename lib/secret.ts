import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

function key(): Buffer {
  const configured = process.env.GMAIL_TOKEN_ENCRYPTION_KEY
  if (!configured) throw new Error('GMAIL_TOKEN_ENCRYPTION_KEY is required for Gmail OAuth storage.')
  return createHash('sha256').update(configured).digest()
}

export function encryptSecret(value: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `enc:v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${encrypted.toString('base64url')}`
}

export function decryptSecret(value: string): string {
  if (!value.startsWith('enc:v1:')) return value
  const [, , ivText, tagText, encryptedText] = value.split(':')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8')
}
