'use client'

import { useCallback, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Screenshot } from '@/lib/contacts'

const MAX_SCREENSHOTS = 10
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_DIMENSION = 2000
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

type PendingFile = {
  key: string
  previewUrl: string
  status: 'uploading' | 'error'
  error?: string
}

async function resizeIfNeeded(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const longest = Math.max(bitmap.width, bitmap.height)
  if (longest <= MAX_DIMENSION) {
    bitmap.close()
    return file
  }

  const scale = MAX_DIMENSION / longest
  const width = Math.round(bitmap.width * scale)
  const height = Math.round(bitmap.height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bitmap.close()
    return file
  }
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  const outType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, outType, 0.85))
  if (!blob) return file

  return new File([blob], file.name, { type: blob.type })
}

export default function ScreenshotUpload({
  contactId,
  screenshots,
  uploadScreenshot,
  deleteScreenshot,
}: {
  contactId: string
  screenshots: Screenshot[]
  uploadScreenshot: (contactId: string, formData: FormData) => Promise<{ error: string | null }>
  deleteScreenshot: (contactId: string, screenshotId: string, storagePath: string) => Promise<void>
}) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<PendingFile[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Optimistic delete: track which ids are being removed locally so the UI
  // updates instantly. If the server action fails, the id is removed from
  // this set and the screenshot reappears. router.refresh() syncs the final
  // server state silently in the background after the action completes.
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())

  const processFiles = useCallback(
    async (fileList: FileList | File[]) => {
      setFormError(null)
      const files = Array.from(fileList)

      for (const file of files) {
        const visibleCount = screenshots.filter((s) => !removingIds.has(s.id)).length
        const slotsLeft = MAX_SCREENSHOTS - visibleCount - pending.length
        if (slotsLeft <= 0) {
          setFormError(`Max ${MAX_SCREENSHOTS} screenshots per contact — reached the limit.`)
          break
        }
        if (!ACCEPTED_TYPES.includes(file.type)) {
          setFormError(`${file.name}: unsupported format (only JPG, PNG, WEBP).`)
          continue
        }
        if (file.size > MAX_FILE_BYTES) {
          setFormError(`${file.name}: file too large (max 5 MB).`)
          continue
        }

        const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`
        const previewUrl = URL.createObjectURL(file)
        setPending((prev) => [...prev, { key, previewUrl, status: 'uploading' }])

        try {
          const resized = await resizeIfNeeded(file)
          const formData = new FormData()
          formData.set('file', resized, file.name)
          const result = await uploadScreenshot(contactId, formData)
          if (result.error) {
            setPending((prev) =>
              prev.map((p) => (p.key === key ? { ...p, status: 'error', error: result.error ?? undefined } : p))
            )
          } else {
            setPending((prev) => prev.filter((p) => p.key !== key))
            router.refresh()
          }
        } catch (err) {
          console.error('[screenshot-upload] threw before/around action call', err)
          const message = err instanceof Error ? err.message : 'Upload failed.'
          setPending((prev) =>
            prev.map((p) => (p.key === key ? { ...p, status: 'error', error: message } : p))
          )
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contactId, screenshots, removingIds, pending.length, uploadScreenshot, router]
  )

  async function handleDelete(screenshot: Screenshot) {
    // Optimistic: hide immediately
    setRemovingIds((prev) => new Set(prev).add(screenshot.id))
    try {
      await deleteScreenshot(contactId, screenshot.id, screenshot.storage_path)
      // Sync server state quietly — no visible delay for the user
      router.refresh()
    } catch (err) {
      // Rollback: make the screenshot reappear
      console.error('[screenshot-upload] delete failed', err)
      setRemovingIds((prev) => {
        const next = new Set(prev)
        next.delete(screenshot.id)
        return next
      })
      setFormError('Could not remove the screenshot. Try again.')
    }
  }

  const visibleScreenshots = screenshots.filter((s) => !removingIds.has(s.id))

  return (
    <div className="screenshot-upload">
      <div
        className={`dropzone${dragOver ? ' dropzone-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) processFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <p>Drag & drop screenshots here, or click to browse</p>
        <p className="hint dim mono">
          {visibleScreenshots.length + pending.length}/{MAX_SCREENSHOTS}
        </p>
      </div>

      {formError && (
        <div className="scrape-result mono" style={{ color: 'var(--bad, #D95F4E)' }}>
          {formError}
        </div>
      )}

      {(visibleScreenshots.length > 0 || pending.length > 0) && (
        <div className="screenshot-grid">
          {visibleScreenshots.map((s) => (
            <div key={s.id} className="screenshot-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.url} alt="" />
              <button
                type="button"
                className="btn-ghost small"
                onClick={() => handleDelete(s)}
              >
                Remove
              </button>
            </div>
          ))}
          {pending.map((p) => (
            <div key={p.key} className="screenshot-thumb">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.previewUrl} alt="" style={{ opacity: p.status === 'error' ? 0.5 : 1 }} />
              {p.status === 'uploading' && <span className="hint dim mono">Uploading…</span>}
              {p.status === 'error' && (
                <span className="hint mono" style={{ color: 'var(--bad, #D95F4E)' }}>
                  {p.error}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}