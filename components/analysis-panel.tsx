'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import type { AnalysisJob, EmailVariant, ScoreBreakdown } from '@/lib/contacts'

const EMAIL_VARIANTS: { key: EmailVariant; label: string }[] = [
  { key: 'email_technical', label: 'Technical' },
  { key: 'email_warm', label: 'Warm' },
  { key: 'email_followup', label: 'Follow-up' },
]

export default function AnalysisPanel({
  contactId,
  screenshotCount,
  scoreBreakdown,
  analysisSummary,
  priorityScore,
  emails,
  updateEmailVariant,
}: {
  contactId: string
  screenshotCount: number
  scoreBreakdown: ScoreBreakdown | null
  analysisSummary: string | null
  priorityScore: number | null
  emails: Record<EmailVariant, string | null>
  updateEmailVariant: (contactId: string, variant: EmailVariant, body: string) => Promise<void>
}) {
  const router = useRouter()
  const [job, setJob] = useState<AnalysisJob | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const channelRef = useRef<RealtimeChannel | null>(null)

  useEffect(() => {
    if (!job || job.status === 'completed' || job.status === 'failed') return

    const supabase = createClient()
    let cancelled = false

    async function subscribe() {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (cancelled) return
      supabase.realtime.setAuth(session?.access_token)

      const channel = supabase
        .channel(`analysis_jobs:${job!.id}`)
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'analysis_jobs', filter: `id=eq.${job!.id}` },
          (payload) => {
            const next = payload.new as AnalysisJob
            setJob(next)
            if (next.status === 'completed' || next.status === 'failed') {
              router.refresh()
            }
          }
        )
        .subscribe((status, err) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error('analysis_jobs realtime subscription failed', status, err)
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

  async function handleAnalyze() {
    setFormError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/contacts/${contactId}/analyze`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setFormError(data?.error ?? 'Could not start the analysis.')
        return
      }
      setJob({
        id: data.job_id,
        contact_id: contactId,
        status: 'queued',
        error: null,
        started_at: null,
        finished_at: null,
      })
    } catch {
      setFormError('Could not reach the analysis service.')
    } finally {
      setSubmitting(false)
    }
  }

  const running = !!job && (job.status === 'queued' || job.status === 'running')

  return (
    <section className="panel">
      <div className="eyebrow">
        <span>Analysis &amp; outreach</span>
        {priorityScore != null && <span className="mono">{priorityScore}/10</span>}
      </div>

      {screenshotCount === 0 && !scoreBreakdown && (
        <p className="hint dim">Upload at least one screenshot before analyzing.</p>
      )}

      <button
        className="btn-primary"
        type="button"
        disabled={submitting || running || screenshotCount === 0}
        onClick={handleAnalyze}
      >
        {running ? (
          <>
            <span className="rec-dot" /> Analyzing…
          </>
        ) : scoreBreakdown ? (
          'Re-analyze'
        ) : (
          'Analyze Instagram'
        )}
      </button>

      {formError && (
        <div className="scrape-result mono" style={{ color: 'var(--rec)' }}>
          {formError}
        </div>
      )}
      {job?.status === 'failed' && (
        <div className="scrape-result mono" style={{ color: 'var(--rec)' }}>
          ✗ Analysis failed{job.error ? `: ${job.error}` : ''}
        </div>
      )}

      {analysisSummary && <p className="top-gap">{analysisSummary}</p>}

      {scoreBreakdown && (
        <div className="score-breakdown top-gap">
          {scoreBreakdown.dimensions.map((d) => (
            <div key={d.key} className="score-row">
              <div className="score-label mono dim">
                <span>{d.label}</span>
                <span>
                  {d.score}/{d.max}
                </span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${(d.score / d.max) * 100}%` }} />
              </div>
              <p className="hint dim">{d.note}</p>
            </div>
          ))}
          <div className="score-total mono">
            Total: {scoreBreakdown.total_score}/{scoreBreakdown.total_max}
          </div>
        </div>
      )}

      {scoreBreakdown && (
        <div className="email-variants top-gap">
          {EMAIL_VARIANTS.map(({ key, label }) => (
            <EmailVariantEditor
              key={key}
              contactId={contactId}
              variant={key}
              label={label}
              initialValue={emails[key] ?? ''}
              updateEmailVariant={updateEmailVariant}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function EmailVariantEditor({
  contactId,
  variant,
  label,
  initialValue,
  updateEmailVariant,
}: {
  contactId: string
  variant: EmailVariant
  label: string
  initialValue: string
  updateEmailVariant: (contactId: string, variant: EmailVariant, body: string) => Promise<void>
}) {
  const [value, setValue] = useState(initialValue)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  return (
    <div className="email-variant">
      <div className="eyebrow">{label}</div>
      <textarea
        rows={6}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setSaved(false)
        }}
      />
      <button
        className="btn-ghost small"
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            await updateEmailVariant(contactId, variant, value)
            setSaved(true)
          })
        }
      >
        {isPending ? '…' : saved ? 'Saved' : 'Save'}
      </button>
    </div>
  )
}
