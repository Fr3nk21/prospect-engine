// Stateless unsubscribe token: HMAC-SHA256(contact_id) keyed with CRON_SECRET.
// No extra table — the contact id travels in the token itself, the HMAC just
// proves it wasn't tampered with.

import { createHmac, timingSafeEqual } from 'node:crypto'

function sign(contactId: string): string {
  return createHmac('sha256', process.env.CRON_SECRET!).update(contactId).digest('hex')
}

export function generateUnsubscribeToken(contactId: string): string {
  return `${contactId}.${sign(contactId)}`
}

export function verifyUnsubscribeToken(token: string): string | null {
  const separator = token.lastIndexOf('.')
  if (separator === -1) return null

  const contactId = token.slice(0, separator)
  const signature = token.slice(separator + 1)
  const expected = sign(contactId)

  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  return contactId
}
