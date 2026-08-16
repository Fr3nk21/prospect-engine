'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function updateAnalysisContext(formData: FormData) {
  const value = (formData.get('analysis_context') as string | null)?.trim()
  if (!value) return

  const supabase = await createClient()
  await supabase.from('settings').update({ value }).eq('key', 'analysis_context')

  revalidatePath('/settings')
}
