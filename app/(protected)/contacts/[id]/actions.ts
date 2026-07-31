'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { sendGmailMessage } from '@/lib/gmail'
import type { EmailVariant } from '@/lib/contacts'

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

const MAX_SCREENSHOTS = 10

export async function uploadScreenshot(
  contactId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  const file = formData.get('file') as File | null
  if (!file) return { error: 'No file provided.' }

  const supabase = await createClient()

  const { count } = await supabase
    .from('screenshots')
    .select('*', { count: 'exact', head: true })
    .eq('contact_id', contactId)

  if ((count ?? 0) >= MAX_SCREENSHOTS) {
    return { error: `Max ${MAX_SCREENSHOTS} screenshots per contact — remove one first.` }
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '-')
  const path = `${contactId}/${Date.now()}_${safeName}`

  const { error: uploadError } = await supabase.storage
    .from('screenshots')
    .upload(path, file, { contentType: file.type })
  if (uploadError) return { error: uploadError.message }

  const { error: insertError } = await supabase
    .from('screenshots')
    .insert({ contact_id: contactId, storage_path: path })
  if (insertError) {
    await supabase.storage.from('screenshots').remove([path])
    return { error: insertError.message }
  }

  revalidatePath(`/contacts/${contactId}`)
  return { error: null }
}

export async function updateEmailVariant(contactId: string, variant: EmailVariant, body: string) {
  const supabase = await createClient()
  await supabase.from('contacts').update({ [variant]: body }).eq('id', contactId)
  revalidatePath(`/contacts/${contactId}`)
}

export async function sendEmail(
  contactId: string,
  variant: EmailVariant,
  body: string
): Promise<{ error: string | null }> {
  const trimmedBody = body.trim()
  if (!trimmedBody) return { error: 'Email body is empty.' }

  const supabase = await createClient()

  const { data: contact } = await supabase
    .from('contacts')
    .select('name, email, status, gmail_thread_id, gmail_message_id')
    .eq('id', contactId)
    .single()

  if (!contact?.email) return { error: 'This contact has no email address on file.' }

  // A prior gmail_message_id means an earlier email already went to this
  // contact — thread this one as a reply instead of starting a new
  // conversation (subject gets "Re: " automatically inside sendGmailMessage).
  let sent: { id: string; threadId: string; messageId: string }
  try {
    sent = await sendGmailMessage({
      to: contact.email,
      subject: `${contact.name} — quick thought`,
      body: trimmedBody,
      threadId: contact.gmail_message_id ? contact.gmail_thread_id ?? undefined : undefined,
      inReplyTo: contact.gmail_message_id ?? undefined,
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not send the email.' }
  }

  const emailVariant = variant.replace(/^email_/, '') as 'technical' | 'warm' | 'followup'

  // Only "To contact" moves to "Contacted" here — a follow-up sent while
  // already "In conversation" (etc.) shouldn't regress the status.
  const statusUpdate: Record<string, string> = {
    gmail_thread_id: sent.threadId,
    gmail_message_id: sent.messageId,
  }
  if (contact.status === 'To contact') statusUpdate.status = 'Contacted'

  await supabase.from('contacts').update(statusUpdate).eq('id', contactId)

  await supabase.from('contact_events').insert({
    contact_id: contactId,
    type: 'email_sent',
    email_variant: emailVariant,
    body: trimmedBody,
  })

  revalidatePath(`/contacts/${contactId}`)
  revalidatePath('/contacts')

  return { error: null }
}

export async function deleteScreenshot(
  contactId: string,
  screenshotId: string,
  storagePath: string
) {
  const supabase = await createClient()
  await supabase.storage.from('screenshots').remove([storagePath])
  await supabase.from('screenshots').delete().eq('id', screenshotId)

  revalidatePath(`/contacts/${contactId}`)
}
