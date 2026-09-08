'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

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
  const router = useRouter()

  function handleClick() {
    if (!window.confirm(`Eliminating ${contactName}. This cannot be undone.`)) return
    startTransition(async () => {
      await deleteContact(contactId)
      router.back()
    })
  }

  return (
    <button className="btn-danger wide" disabled={isPending} onClick={handleClick}>
      {isPending ? 'Deleting…' : 'Delete contact'}
    </button>
  )
}