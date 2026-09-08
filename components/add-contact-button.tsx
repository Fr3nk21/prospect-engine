'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'

type AddContactResult = { error: string | null; id?: string }

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
  fontSize: '0.85rem',
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: '6px',
  border: '1px solid rgba(255,255,255,0.15)',
  background: 'rgba(255,255,255,0.04)',
  color: 'inherit',
  font: 'inherit',
  width: '100%',
}

export default function AddContactButton({
  addContact,
}: {
  addContact: (formData: FormData) => Promise<AddContactResult>
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  function close() {
    if (isPending) return
    setError(null)
    setOpen(false)
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    setError(null)
    startTransition(async () => {
      const result = await addContact(formData)
      if (result.error) {
        setError(result.error)
        return
      }
      setOpen(false)
      if (result.id) router.push(`/contacts/${result.id}`)
    })
  }

  return (
    <>
      <button className="btn-primary" type="button" onClick={() => setOpen(true)}>
        + Add contact
      </button>

      {open && (
        <div className="modal-backdrop" onClick={close}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-head">
              <span className="eyebrow">New contact</span>
              <button className="btn-ghost small" type="button" onClick={close}>
                ✕
              </button>
            </div>

            <form
              onSubmit={onSubmit}
              style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '16px' }}
            >
              <label style={fieldStyle}>
                Business name *
                <input name="name" required autoFocus style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                Address
                <input name="address" style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                Suburb
                <input name="suburb" style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                Email
                <input name="email" type="email" style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                Phone
                <input name="phone" style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                Website
                <input name="website" style={inputStyle} />
              </label>
              <label style={fieldStyle}>
                Instagram
                <input name="instagram" placeholder="@handle" style={inputStyle} />
              </label>

              {error && (
                <p className="hint mono" style={{ color: 'var(--rec)' }}>
                  {error}
                </p>
              )}

              <div className="email-variant-actions" style={{ marginTop: '4px' }}>
                <button className="btn-ghost small" type="button" onClick={close} disabled={isPending}>
                  Cancel
                </button>
                <button className="btn-primary small" type="submit" disabled={isPending}>
                  {isPending ? 'Adding…' : 'Add contact'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  )
}