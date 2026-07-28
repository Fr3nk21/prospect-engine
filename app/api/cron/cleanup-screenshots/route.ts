import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

const DEFAULT_TTL_DAYS = 5

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()

  const { data: setting } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'screenshot_ttl_days')
    .single()

  const ttlDays = typeof setting?.value === 'number' ? setting.value : DEFAULT_TTL_DAYS
  const cutoff = new Date(Date.now() - ttlDays * 24 * 60 * 60 * 1000).toISOString()

  const { data: expired, error: selectError } = await supabase
    .from('screenshots')
    .select('id, storage_path')
    .lt('created_at', cutoff)

  if (selectError) {
    console.error('[cron/cleanup-screenshots] select failed:', selectError.message)
    return NextResponse.json({ error: selectError.message }, { status: 500 })
  }

  if (!expired || expired.length === 0) {
    console.log(`[cron/cleanup-screenshots] nothing older than ${ttlDays}d — 0 files, 0 rows removed`)
    return NextResponse.json({ removed_files: 0, removed_rows: 0 })
  }

  const paths = expired.map((row) => row.storage_path)
  const { error: storageError } = await supabase.storage.from('screenshots').remove(paths)
  if (storageError) {
    console.error('[cron/cleanup-screenshots] storage removal failed:', storageError.message)
    return NextResponse.json({ error: storageError.message }, { status: 500 })
  }

  const ids = expired.map((row) => row.id)
  const { error: deleteError } = await supabase.from('screenshots').delete().in('id', ids)
  if (deleteError) {
    console.error('[cron/cleanup-screenshots] row deletion failed:', deleteError.message)
    return NextResponse.json({ error: deleteError.message }, { status: 500 })
  }

  console.log(`[cron/cleanup-screenshots] removed ${paths.length} files, ${ids.length} rows (ttl=${ttlDays}d)`)
  return NextResponse.json({ removed_files: paths.length, removed_rows: ids.length })
}
