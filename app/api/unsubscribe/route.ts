import { createAdminClient } from '@/lib/supabase/admin'
import { verifyUnsubscribeToken } from '@/lib/unsubscribe-token'

function page(title: string, message: string): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    /* The logo file is light grey on a transparent background, so the page is dark. */
    body { font-family: system-ui, sans-serif; background: #0b0b0b; color: #f2f2f2; max-width: 32rem; margin: 0 auto; padding: 4rem 1.5rem; text-align: center; }
    .logo { display: block; height: 56px; width: auto; margin: 0 auto 3rem; }
    h1 { font-size: 1.25rem; }
    p { line-height: 1.5; color: #cfcfcf; }
    .site { margin-top: 2rem; font-size: 0.9rem; }
    .site a { color: #f2f2f2; }
  </style>
</head>
<body>
  <img class="logo" src="/unfocus-logo.png" alt="UnFocus" />
  <h1>${title}</h1>
  <p>${message}</p>
  <p class="site"><a href="https://unfocus.com.au">unfocus.com.au</a></p>
</body>
</html>`
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token')
  const contactId = token ? verifyUnsubscribeToken(token) : null

  if (!contactId) {
    return page('Invalid link', 'This unsubscribe link is invalid or has expired.')
  }

  const supabase = createAdminClient()

  const { data: contact } = await supabase
    .from('contacts')
    .select('id, place_id, name')
    .eq('id', contactId)
    .single()

  if (!contact) {
    return page('Invalid link', 'This unsubscribe link is invalid or has expired.')
  }

  await supabase
    .from('contacts')
    .update({ unsubscribed_at: new Date().toISOString(), status: 'Not interested' })
    .eq('id', contactId)

  if (contact.place_id) {
    await supabase
      .from('blocklist')
      .upsert(
        { place_id: contact.place_id, name: contact.name, reason: 'unsubscribed' },
        { onConflict: 'place_id', ignoreDuplicates: true }
      )
  }

  return page('You have been unsubscribed', "You won't receive any further emails from UnFocus.")
}
