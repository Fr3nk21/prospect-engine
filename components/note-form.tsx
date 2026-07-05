'use client'

import { useRef } from 'react'

export default function NoteForm({
  contactId,
  addNote,
}: {
  contactId: string
  addNote: (contactId: string, formData: FormData) => Promise<void>
}) {
  const formRef = useRef<HTMLFormElement>(null)

  return (
    <form
      ref={formRef}
      className="nota-add"
      action={async (formData) => {
        await addNote(contactId, formData)
        formRef.current?.reset()
      }}
    >
      <textarea name="body" rows={2} placeholder="Add a note…" required />
      <button className="btn-ghost" type="submit">
        Save note
      </button>
    </form>
  )
}
