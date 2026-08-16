// Server-only Gmail send helper (Module 4.2). Uses gmail.send scope only —
// no read access, so this can't check inboxes or threads (that's Module 4.3,
// a separate OAuth re-consent).

import { randomUUID } from 'node:crypto'
import { generateUnsubscribeToken } from '@/lib/unsubscribe-token'

const FROM_ADDRESS = 'info@unfocus.com.au'

const SIGNATURE = [
  'Francesco Bugugnoli',
  'Visual Content Partner',
  '0476 278 891',
  'UnFocus - Strategic video content',
].join('\n')

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

// Plain text (with \n line breaks) -> HTML, preserving line breaks.
function textToHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>')
}

// HTML body: the plain-text body + signature, plus a required (Spam Act
// 2003) unsubscribe link as a readable "click here" instead of a raw URL.
// Stateless: the token encodes the contact id, so there's no unsubscribe
// table to keep in sync.
function buildHtmlBody(body: string, contactId: string): string {
  const token = generateUnsubscribeToken(contactId)
  const url = `${process.env.NEXT_PUBLIC_APP_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`

  return [
    `<div style="font-family: sans-serif; font-size: 14px; color: #1a1a1a;">`,
    textToHtml(body),
    '<br><br>',
    '--<br>',
    textToHtml(SIGNATURE),
    '<br><br>',
    `<span style="font-size: 12px; color: #888;">If you'd rather not receive further emails from us, <a href="${url}">click here</a> to unsubscribe.</span>`,
    '</div>',
  ].join('\n')
}

async function getAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      refresh_token: process.env.GMAIL_REFRESH_TOKEN!,
      grant_type: 'refresh_token',
    }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Gmail token refresh failed: ${data.error_description ?? data.error ?? res.status}`)
  }
  return data.access_token as string
}

function base64UrlEncode(input: string): string {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

// RFC 2047 encoded-word: headers are 7-bit only, so any non-ASCII subject
// (accents, em dashes, emoji) must be wrapped as =?UTF-8?B?<base64>?= or it
// arrives corrupted (seen in testing: an em dash in a contact name broke
// the whole subject).
function encodeHeaderValue(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`
}

// The Gmail API's own message `id` is not the RFC822 Message-ID header, and
// reading that header back would require the gmail.readonly scope (which
// this app deliberately doesn't have — see module header). So we mint our
// own Message-ID up front, set it explicitly on the outgoing message, and
// persist it — the next send can then thread off it via In-Reply-To/
// References without ever needing to read a message back.
function generateMessageId(): string {
  return `<${randomUUID()}@unfocus.com.au>`
}

function buildRawMessage({
  to,
  subject,
  body,
  messageId,
  inReplyTo,
  contactId,
}: {
  to: string
  subject: string
  body: string
  messageId: string
  inReplyTo?: string
  contactId: string
}): string {
  const headers = [
    `From: ${FROM_ADDRESS}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Message-ID: ${messageId}`,
  ]
  if (inReplyTo) {
    headers.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`)
  }
  headers.push('Content-Type: text/html; charset="UTF-8"')

  const message = [...headers, '', buildHtmlBody(body, contactId)].join('\r\n')
  return base64UrlEncode(message)
}

export async function sendGmailMessage({
  to,
  subject,
  body,
  threadId,
  inReplyTo,
  contactId,
}: {
  to: string
  subject: string
  body: string
  // Both must come from a prior send to this contact — thread the reply
  // instead of starting a new conversation. Omit both for a first send.
  threadId?: string
  inReplyTo?: string
  contactId: string
}): Promise<{ id: string; threadId: string; messageId: string }> {
  const accessToken = await getAccessToken()
  const messageId = generateMessageId()
  const raw = buildRawMessage({
    to,
    subject: inReplyTo ? `Re: ${subject}` : subject,
    body,
    messageId,
    inReplyTo,
    contactId,
  })

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Gmail send failed: ${data.error?.message ?? res.status}`)
  }

  return { id: data.id, threadId: data.threadId, messageId }
}
