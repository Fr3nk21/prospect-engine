'use client'

import { useTransition } from 'react'
import { STATUSES } from '@/lib/contacts'

export default function StatusSelect({
  contactId,
  status,
  updateStatus,
}: {
  contactId: string
  status: string
  updateStatus: (contactId: string, newStatus: string) => Promise<void>
}) {
  const [isPending, startTransition] = useTransition()

  return (
    <select
      value={status}
      disabled={isPending}
      onChange={(e) => startTransition(() => updateStatus(contactId, e.target.value))}
    >
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  )
}
