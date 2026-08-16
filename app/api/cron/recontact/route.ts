import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_RECONTACT_MONTHS = 9

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'recontact_months')
    .single()

  const months = typeof setting?.value === 'number' ? setting.value : DEFAULT_RECONTACT_MONTHS
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffDate = cutoff.toISOString().slice(0, 10)

  // unsubscribed_at is an explicit opt-out — the recontact cron must never
  // override it, no matter how stale last_contact_date is.
  const { data: updated, error } = await supabase
    .from('contacts')
    .update({ status: 'To recontact' })
    .eq('status', 'Not interested')
    .is('unsubscribed_at', null)
    .lt('last_contact_date', cutoffDate)
    .select('id')

  if (error) {
    console.error('[cron/recontact] update failed:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  console.log(`[cron/recontact] moved ${updated?.length ?? 0} contacts to 'To recontact' (cutoff=${months}mo)`)
  return NextResponse.json({ moved: updated?.length ?? 0 })
}
