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
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.5rem; color: #1a1a1a; }
    h1 { font-size: 1.25rem; }
  </style>
</head>
<body>
  <h1>${title}</h1>
  <p>${message}</p>
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

  return page('You have been unsubscribed', "You won't receive any further emails from UnFocus. Sorry for the inconvenience.")
}
