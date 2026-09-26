import nodemailer from 'nodemailer'
import { google } from 'googleapis'
import { pool } from './db'
import { decryptSecret } from './secret'

export interface SendMailOptions {
  from?: string
  to: string
  subject: string
  text?: string
  html?: string
  replyTo?: string
  inReplyTo?: string
  references?: string
  headers?: Record<string, string>
}

export interface EmailSenderConfig {
  transporter: {
    sendMail: (options: SendMailOptions) => Promise<{ messageId: string }>
  }
  fromEmail: string
  replyTo: string | undefined
}

/**
 * Builds an RFC 2822 formatted MIME email string and base64url encodes it for the Gmail REST API.
 */
function buildRawMimeMessage(options: SendMailOptions, from: string, replyTo?: string): string {
  const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(2)}`
  const lines: string[] = []

  lines.push(`From: ${options.from || from}`)
  lines.push(`To: ${options.to}`)
  lines.push(`Subject: =?UTF-8?B?${Buffer.from(options.subject, 'utf-8').toString('base64')}?=`)
  if (options.replyTo || replyTo) {
    lines.push(`Reply-To: ${options.replyTo || replyTo}`)
  }
  if (options.inReplyTo) {
    lines.push(`In-Reply-To: <${options.inReplyTo}>`)
  }
  if (options.references) {
    lines.push(`References: <${options.references}>`)
  }
  for (const [name, value] of Object.entries(options.headers || {})) {
    lines.push(`${name}: ${value}`)
  }
  lines.push('MIME-Version: 1.0')

  if (options.html && options.text) {
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    lines.push('')
    lines.push(`--${boundary}`)
    lines.push('Content-Type: text/plain; charset=UTF-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(options.text, 'utf-8').toString('base64'))
    lines.push('')
    lines.push(`--${boundary}`)
    lines.push('Content-Type: text/html; charset=UTF-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(options.html, 'utf-8').toString('base64'))
    lines.push('')
    lines.push(`--${boundary}--`)
  } else if (options.html) {
    lines.push('Content-Type: text/html; charset=UTF-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(options.html, 'utf-8').toString('base64'))
  } else {
    lines.push('Content-Type: text/plain; charset=UTF-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(options.text || '', 'utf-8').toString('base64'))
  }

  const rawMessage = lines.join('\r\n')
  return Buffer.from(rawMessage, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

import dns from 'node:dns'

// Force IPv4 lookup first on Node.js / Windows to prevent EAI_AGAIN DNS timeouts
try {
  dns.setDefaultResultOrder('ipv4first')
} catch {
  // Ignore in environments where not supported
}

export async function getEmailSender(): Promise<EmailSenderConfig> {
  // 1. Check settings table for OAuth tokens first
  let dbUser: string | null = null
  let dbRefreshToken: string | null = null

  try {
    const res = await pool.query(
      `SELECT gmail_user, gmail_refresh_token FROM settings WHERE id = 1`
    )
    if (res.rows.length > 0) {
      dbUser = res.rows[0].gmail_user || null
      dbRefreshToken = res.rows[0].gmail_refresh_token || null
    }
  } catch {
    // Column may not exist on initial run
  }

  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET
  const refreshToken = dbRefreshToken ? decryptSecret(dbRefreshToken) : process.env.GMAIL_REFRESH_TOKEN
  const user = dbUser || process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  const senderName = process.env.SENDER_NAME || 'Bryan Allen'
  const replyTo = process.env.REPLY_TO_EMAIL || (user || undefined)
  const fromEmail = `${senderName} <${user || 'outreach@coldstart.app'}>`

  // Strategy A: Google OAuth2 with official Gmail REST API (Reliable, no SMTP 535 rejection)
  if (clientId && clientSecret && refreshToken) {
    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret)
    oauth2Client.setCredentials({ refresh_token: refreshToken })

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client })

    return {
      transporter: {
        sendMail: async (options: SendMailOptions) => {
          const raw = buildRawMimeMessage(options, fromEmail, replyTo)

          // Retry up to 3 times on transient network / DNS errors like EAI_AGAIN
          let lastErr: unknown
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              const res = await gmail.users.messages.send({
                userId: 'me',
                requestBody: {
                  raw,
                },
              })
              const messageId = res.data.id || `gmail-${Date.now()}`
              return { messageId }
            } catch (err: unknown) {
              lastErr = err
              const errMsg = err instanceof Error ? err.message : String(err)
              const isTransient = errMsg.includes('EAI_AGAIN') || errMsg.includes('ETIMEDOUT') || errMsg.includes('ECONNRESET') || errMsg.includes('ENOTFOUND')

              if (attempt < 3 && isTransient) {
                // Wait before retrying
                await new Promise((r) => setTimeout(r, attempt * 1000))
                continue
              }
              break
            }
          }

          throw lastErr
        },
      },
      fromEmail,
      replyTo,
    }
  }

  // Strategy B: Standard Gmail App Password via Nodemailer SMTP
  if (user && pass && pass.trim() !== '') {
    const nodeTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: user,
        pass: pass.trim(),
      },
    })

    return {
      transporter: {
        sendMail: async (options: SendMailOptions) => {
          const info = await nodeTransporter.sendMail({
            from: options.from || fromEmail,
            to: options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
            replyTo: options.replyTo || replyTo,
            inReplyTo: options.inReplyTo,
            references: options.references,
            headers: options.headers,
          })
          return { messageId: info.messageId || `smtp-${Date.now()}` }
        },
      },
      fromEmail,
      replyTo,
    }
  }

  throw new Error(
    'No valid email credentials found. Please either connect your Gmail account in the Settings tab (via Google OAuth) or set GMAIL_USER and GMAIL_APP_PASSWORD in .env.local.'
  )
}
