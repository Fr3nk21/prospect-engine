'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { ScrapeJob } from '@/lib/contacts'

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export default function ScrapePanel() {
  const router = useRouter()
  const [location, setLocation] = useState('')
  const [businessType, setBusinessType] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [job, setJob] = useState<ScrapeJob | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const startedAtRef = useRef<number | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') return

    const supabase = createClient()
    let cancelled = false

    async function subscribe() {
      // RLS on scrape_jobs requires the `authenticated` role — the Realtime
      // socket otherwise connects as `anon` and silently receives no rows.
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return
      supabase.realtime.setAuth(session?.access_token)

      const channel = supabase
        .channel(`scrape_jobs:${job!.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'scrape_jobs', filter: `id=eq.${job!.id}` },
          (payload) => {
            const next = payload.new as ScrapeJob
            setJob(next)
            if (next.status === 'completed' || next.status === 'failed') {
              router.refresh()
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('scrape_jobs realtime subscription failed', status, err)
          }
        })

      channelRef.current = channel
    }

    subscribe()

    return () => {
      cancelled = true
      if (channelRef.current) supabase.removeChannel(channelRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id, job?.status])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    const trimmedLocation = location.trim()
    const trimmedType = businessType.trim()
    if (!trimmedLocation || !trimmedType) {
      setFormError('Location and business type are required.')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ location: trimmedLocation, business_type: trimmedType }),
      })
      const data = await res.json()
      if (!res.ok) {
        setFormError(data?.error ?? 'Could not start the search.')
        return
      }

      startedAtRef.current = Date.now()
      setJob({
        id: data.job_id,
        location: trimmedLocation,
        business_type: trimmedType,
        status: 'queued',
        total: null,
        processed: 0,
        new_contacts: 0,
        skipped: 0,
        error: null,
        started_at: null,
        finished_at: null,
      })
    } catch {
      setFormError('Could not reach the scraper service.')
    } finally {
      setSubmitting(false)
    }
  }

  const scraping = !!job && (job.status === 'queued' || job.status === 'running')
  const percent = job?.total ? Math.min(100, Math.round((job.processed / job.total) * 100)) : 0

  let eta: string | null = null
  if (scraping && job?.total && job.processed > 0 && job.started_at) {
    const elapsedSeconds = (Date.now() - new Date(job.started_at).getTime()) / 1000
    const rate = job.processed / elapsedSeconds
    const remaining = job.total - job.processed
    if (rate > 0) eta = formatEta(remaining / rate)
  }

  return (
    <section className="panel scrape-panel">
      <div className="eyebrow">New search</div>
      <form className="scrape-row" onSubmit={handleSubmit}>
        <label className="field">
          <span>Location</span>
          <input
            type="text"
            placeholder="Richmond, VIC"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            disabled={scraping}
          />
        </label>
        <label className="field">
          <span>Business category</span>
          <input
            type="text"
            placeholder="Restaurant"
            value={businessType}
            onChange={(e) => setBusinessType(e.target.value)}
            disabled={scraping}
          />
        </label>
        <button className="btn-primary" type="submit" disabled={submitting || scraping}>
          {scraping ? (
            <>
              <span className="rec-dot" /> Searching…
            </>
          ) : (
            'Start search'
          )}
        </button>
      </form>

      {formError && <div className="scrape-result mono" style={{ color: 'var(--bad, #D95F4E)' }}>{formError}</div>}

      {scraping && (
        <div className="top-gap">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="scrape-stats mono dim">
            {job?.total ? `${job.processed} / ${job.total} (${percent}%)` : 'Searching Google Maps…'}
            {job?.new_contacts ? ` · ${job.new_contacts} new` : ''}
            {job?.skipped ? ` · ${job.skipped} skipped` : ''}
            {eta && ` · ~${eta} remaining`}
          </div>
        </div>
      )}

      {job?.status === 'completed' && (
        <div className="scrape-result mono">
          ✓ {job.new_contacts} new contacts from {job.location} · {job.business_type}
          {job.skipped ? ` (${job.skipped} skipped)` : ''}
        </div>
      )}

      {job?.status === 'failed' && (
        <div className="scrape-result mono" style={{ color: 'var(--bad, #D95F4E)' }}>
          ✗ Search failed{job.error ? `: ${job.error}` : ''}
        </div>
      )}
    </section>
  )
}
