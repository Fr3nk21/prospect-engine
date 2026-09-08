'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { deleteContactsById } from '@/lib/delete-contacts'

export async function deleteContacts(ids: string[]) {
  await deleteContactsById(ids)
  revalidatePath('/contacts')
}

export async function addContact(
  formData: FormData
): Promise<{ error: string | null; id?: string }> {
  const name = (formData.get('name') as string | null)?.trim()
  if (!name) return { error: 'Business name is required.' }

  const email = (formData.get('email') as string | null)?.trim() || null
  const phone = (formData.get('phone') as string | null)?.trim() || null
  const instagram = (formData.get('instagram') as string | null)?.trim() || null
  const website = (formData.get('website') as string | null)?.trim() || null
  const address = (formData.get('address') as string | null)?.trim() || null
  const suburb = (formData.get('suburb') as string | null)?.trim() || null

  const manuallyEditedFields = ['email', 'phone', 'instagram'].filter((key) => {
    const value = formData.get(key) as string | null
    return !!value && value.trim() !== ''
  })

  const supabase = await createClient()

  const { data, error } = await supabase
    .from('contacts')
    .insert({
      place_id: null,
      name,
      address,
      suburb,
      email,
      phone,
      instagram,
      website,
      category: 'Not analysed',
      status: 'To contact',
      is_new_venue: false,
      source: 'manual',
      manually_edited_fields: manuallyEditedFields,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }

  revalidatePath('/contacts')
  return { error: null, id: data.id as string }
}
