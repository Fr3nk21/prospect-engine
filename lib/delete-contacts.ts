import { createClient } from '@/lib/supabase/server'

/**
 * Deletion never touches the blocklist — that's reserved for the
 * "Not interested" status (set via the DB trigger path in actions.ts).
 * Deleting is for cleanup/test/mistakes, and should let a future scrape
 * bring the contact back. contact_events, screenshots and analysis_jobs
 * rows cascade via the FK — screenshot *files* in Storage don't, so
 * they're removed explicitly before the delete.
 */
export async function deleteContactsById(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const supabase = await createClient()

  const { data: screenshotRows } = await supabase
    .from('screenshots')
    .select('storage_path')
    .in('contact_id', ids)

  const paths = (screenshotRows ?? []).map((row) => row.storage_path as string)
  if (paths.length > 0) {
    await supabase.storage.from('screenshots').remove(paths)
  }

  await supabase.from('contacts').delete().in('id', ids)
}
