'use server'

import { revalidatePath } from 'next/cache'
import { deleteContactsById } from '@/lib/delete-contacts'

export async function deleteContacts(ids: string[]) {
  await deleteContactsById(ids)
  revalidatePath('/contacts')
}
