function appUrl(): string {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/$/, '')
}

export function unsubscribeUrl(token: string): string {
  return `${appUrl()}/api/unsubscribe/${encodeURIComponent(token)}`
}

export function senderPostalAddress(): string {
  return (process.env.SENDER_POSTAL_ADDRESS || '').trim()
}

export function assertEmailComplianceConfiguration(): void {
  if (!senderPostalAddress()) {
    throw new Error('SENDER_POSTAL_ADDRESS must be configured before sending outreach.')
  }
}

export function appendComplianceFooter(body: string, token: string): string {
  const address = senderPostalAddress()
  return `${body.trim()}\n\n---\nIf you would rather not receive messages from me, unsubscribe here: ${unsubscribeUrl(token)}\n${process.env.SENDER_NAME || 'Your name'}\n${address}`
}

export function complianceHeaders(token: string): Record<string, string> {
  const url = unsubscribeUrl(token)
  return {
    'List-Unsubscribe': `<${url}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
}
