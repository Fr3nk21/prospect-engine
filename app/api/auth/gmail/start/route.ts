import { NextResponse } from 'next/server'

// Only gmail.send: this module sends, it doesn't read replies (that's a
// later module, out of scope here — would need a re-consent to add
// gmail.readonly).
const SCOPE = 'https://www.googleapis.com/auth/gmail.send'

export async function GET(request: Request) {
  const redirectUri = new URL('/api/auth/gmail/callback', request.url).toString()

  const params = new URLSearchParams({
    client_id: process.env.GMAIL_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    // Forces Google to reissue a refresh_token even if this account
    // already authorized this app before — without it, a repeat consent
    // returns only an access_token.
    prompt: 'consent',
    login_hint: 'info@unfocus.com.au',
  })

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
}
