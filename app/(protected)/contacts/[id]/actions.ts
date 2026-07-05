'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export async function updateContactStatus(contactId: string, newStatus: string) {
  const supabase = await createClient()

  if (newStatus === 'Not interested') {
    const { data: contact } = await supabase
      .from('contacts')
      .select('place_id, name')
      .eq('id', contactId)
      .single()

    if (contact?.place_id) {
      await supabase
        .from('blocklist')
        .upsert(
          { place_id: contact.place_id, name: contact.name },
          { onConflict: 'place_id', ignoreDuplicates: true }
        )
    }
  }

  await supabase.from('contacts').update({ status: newStatus }).eq('id', contactId)

  revalidatePath(`/contacts/${contactId}`)
  revalidatePath('/contacts')
}

export async function addNote(contactId: string, formData: FormData) {
  const body = (formData.get('body') as string | null)?.trim()
  if (!body) return

  const supabase = await createClient()
  await supabase.from('contact_events').insert({ contact_id: contactId, type: 'note', body })

  revalidatePath(`/contacts/${contactId}`)
}
