import { NextResponse } from 'next/server'

function htmlResponse(body: string, status = 200) {
  return new NextResponse(
    `<html><body style="font-family: monospace; padding: 2rem; max-width: 640px;">${body}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  )
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const error = url.searchParams.get('error')

  if (error) {
    return htmlResponse(`<h2>OAuth error</h2><p>${error}</p>`, 400)
  }
  if (!code) {
    return htmlResponse('<h2>Missing code</h2>', 400)
  }

  const redirectUri = new URL('/api/auth/gmail/callback', request.url).toString()

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GMAIL_CLIENT_ID!,
      client_secret: process.env.GMAIL_CLIENT_SECRET!,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  const tokens = await tokenResponse.json()

  if (!tokenResponse.ok) {
    return htmlResponse(
      `<h2>Token exchange failed</h2><pre>${JSON.stringify(tokens, null, 2)}</pre>`,
      500
    )
  }

  if (!tokens.refresh_token) {
    return htmlResponse(`
      <h2>No refresh token returned</h2>
      <p>Google only issues one on first consent, or when it is forced.
      This account may have already authorized this app previously.</p>
      <p>Revoke access at
      <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>
      and try <a href="/api/auth/gmail/start">/api/auth/gmail/start</a> again.</p>
    `)
  }

  return htmlResponse(`
    <h2>Gmail connected</h2>
    <p>Copy this into <code>GMAIL_REFRESH_TOKEN</code> in <code>.env.local</code>
    (and in Vercel project env vars for production), then restart the dev server:</p>
    <pre style="background:#eee; padding:1rem; word-break:break-all; white-space:pre-wrap;">${tokens.refresh_token}</pre>
    <p>This page won't show the token again unless you revoke access and
    reconsent via <a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>
  `)
}
