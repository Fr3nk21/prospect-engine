'use client'

import { useTransition } from 'react'

export default function DeleteContactButton({
  contactId,
  contactName,
  deleteContact,
}: {
  contactId: string
  contactName: string
  deleteContact: (contactId: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()

  function handleClick() {
    if (!window.confirm(`Eliminating ${contactName}. This cannot be undone.`)) return
    startTransition(() => deleteContact(contactId))
  }

  return (
    <button className="btn-danger wide" disabled={isPending} onClick={handleClick}>
      {isPending ? 'Deleting…' : 'Delete contact'}
    </button>
  )
}
