// Server-only Gmail send helper (Module 4.2). Uses gmail.send scope only —
// no read access, so this can't check inboxes or threads (that's Module 4.3,
// a separate OAuth re-consent).

const FROM_ADDRESS = 'info@unfocus.com.au'

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

function buildRawMessage({ to, subject, body }: { to: string; subject: string; body: string }): string {
  const message = [
    `From: ${FROM_ADDRESS}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    '',
    body,
  ].join('\r\n')

  return base64UrlEncode(message)
}

export async function sendGmailMessage({
  to,
  subject,
  body,
}: {
  to: string
  subject: string
  body: string
}): Promise<{ id: string; threadId: string }> {
  const accessToken = await getAccessToken()
  const raw = buildRawMessage({ to, subject, body })

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  })

  const data = await res.json()
  if (!res.ok) {
    throw new Error(`Gmail send failed: ${data.error?.message ?? res.status}`)
  }

  return { id: data.id, threadId: data.threadId }
}
