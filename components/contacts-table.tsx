'use client'

import { useState, useTransition, type ReactNode } from 'react'
import ContactRow from '@/components/contact-row'
import { deleteContacts } from '@/app/(protected)/contacts/actions'
import type { ContactListItem } from '@/lib/contacts'

export default function ContactsTable({
  rows,
  headerCells,
}: {
  rows: ContactListItem[]
  headerCells: ReactNode
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [isPending, startTransition] = useTransition()

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDeleteSelected() {
    const count = selected.size
    const label = count === 1 ? 'contact' : 'contacts'
    if (!window.confirm(`Eliminating ${count} ${label}. This cannot be undone.`)) return

    const ids = Array.from(selected)
    startTransition(async () => {
      await deleteContacts(ids)
      setSelected(new Set())
    })
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="bulk-actions">
          <span className="mono dim">{selected.size} selected</span>
          <button className="btn-danger small" disabled={isPending} onClick={handleDeleteSelected}>
            {isPending ? 'Deleting…' : 'Delete selected'}
          </button>
        </div>
      )}

      <table className="contacts">
        <thead>
          <tr>
            <th className="checkbox-col">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all"
              />
            </th>
            {headerCells}
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              selected={selected.has(c.id)}
              onToggleSelect={() => toggleOne(c.id)}
            />
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="empty">
                No contacts match these filters. Try widening them.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  )
}
