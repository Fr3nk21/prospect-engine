'use client'

export default function BackButton() {
  return (
    <button className="back" onClick={() => window.history.back()}>
      ← All contacts
    </button>
  )
}