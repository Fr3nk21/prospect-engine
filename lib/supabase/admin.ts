import { createClient } from '@supabase/supabase-js'

// service_role key — bypasses RLS. Only use in server code with no user
// session available (e.g. cron routes), never expose to the browser.
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
