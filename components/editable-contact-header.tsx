'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { instagramUrl } from '@/lib/contacts'

type EditableFields = {
  address: string | null
  phone: string | null
  website: string | null
  email: string | null
  instagram: string | null
}

type UpdateResult = { error: string | null }

type ChangesPayload = Partial<Record<'email' | 'phone' | 'instagram', string>>

export default function EditableContactHeader({
  contactId,
  fields,
  updateContactFields,
}: {
  contactId: string
  fields: EditableFields
  updateContactFields: (contactId: string, changes: ChangesPayload) => Promise<UpdateResult>
}) {
  const [editing, setEditing] = useState(false)
  const [values, setValues] = useState({
    phone: fields.phone ?? '',
    email: fields.email ?? '',
    instagram: fields.instagram ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function startEditing() {
    // Resetta i valori sui dati correnti ogni volta che si apre il form,
    // cosi' se annulli e riapri non trovi residui di una modifica scartata.
    setValues({
      phone: fields.phone ?? '',
      email: fields.email ?? '',
      instagram: fields.instagram ?? '',
    })
    setError(null)
    setEditing(true)
  }

  function cancelEditing() {
    setError(null)
    setEditing(false)
  }

  function save() {
    setError(null)
    startTransition(async () => {
      const result = await updateContactFields(contactId, values)
      if (result.error) {
        setError(result.error)
        return
      }
      setEditing(false)
      // Il server action fa revalidatePath, ma il componente client
      // ha bisogno di questo per andare a riprendere i dati freschi.
      router.refresh()
    })
  }

  if (!editing) {
    return (
      <div className="detail-meta-block">
        <div className="detail-meta">
          {fields.address && <span>{fields.address}</span>}
          {fields.website && (
            <a href={fields.website} target="_blank" rel="noreferrer">
              {fields.website}
            </a>
          )}
          {fields.instagram && (
            <a className="mono" href={instagramUrl(fields.instagram)} target="_blank" rel="noreferrer">
              {fields.instagram}
            </a>
          )}
          {fields.phone && <span>{fields.phone}</span>}
          {fields.email && <span>{fields.email}</span>}
        </div>
        <button type="button" className="btn-secondary" onClick={startEditing}>
          Modifica
        </button>
      </div>
    )
  }

  return (
    <div className="edit-contact-fields">
      <label>
        Instagram
        <input
          value={values.instagram}
          onChange={(e) => setValues((v) => ({ ...v, instagram: e.target.value }))}
        />
      </label>
      <label>
        Telefono
        <input
          value={values.phone}
          onChange={(e) => setValues((v) => ({ ...v, phone: e.target.value }))}
        />
      </label>
      <label>
        Email
        <input
          value={values.email}
          onChange={(e) => setValues((v) => ({ ...v, email: e.target.value }))}
        />
      </label>

      {error && <p className="error">{error}</p>}

      <div className="edit-actions">
        <button type="button" onClick={save} disabled={isPending}>
          {isPending ? 'Salvataggio…' : 'Salva'}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={cancelEditing}
          disabled={isPending}
        >
          Annulla
        </button>
      </div>
    </div>
  )
}