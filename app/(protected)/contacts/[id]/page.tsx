import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { CategoryTag, NewVenueBadge, Rating } from '@/components/contact-badges'
import StatusSelect from '@/components/status-select'
import NoteForm from '@/components/note-form'
import Timeline from '@/components/timeline'
import ScreenshotUpload from '@/components/screenshot-upload'
import AnalysisPanel from '@/components/analysis-panel'
import { instagramUrl, type ContactDetail, type ContactEvent, type Screenshot } from '@/lib/contacts'
import {
  updateContactStatus,
  addNote,
  uploadScreenshot,
  deleteScreenshot,
  updateEmailVariant,
  sendEmail,
} from './actions'

const SIGNED_URL_TTL_SECONDS = 3600

export const dynamic = 'force-dynamic'

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: contact }, { data: events }, { data: screenshotRows }] = await Promise.all([
    supabase
      .from('contacts')
      .select(
        'id, place_id, name, address, suburb, phone, website, email, instagram, business_type, rating, review_count, category, is_new_venue, status, last_contact_date, source, priority_score, score_breakdown, analysis, email_technical, email_warm, email_followup'
      )
      .eq('id', id)
      .single(),
    supabase
      .from('contact_events')
      .select('*')
      .eq('contact_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('screenshots')
      .select('id, contact_id, storage_path, created_at')
      .eq('contact_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (!contact) notFound()

  const c = contact as ContactDetail

  const sentVariants = Array.from(
    new Set(
      (events ?? [])
        .filter((e) => e.type === 'email_sent' && e.email_variant)
        .map((e) => e.email_variant as string)
    )
  )

  const screenshots: Screenshot[] = await Promise.all(
    (screenshotRows ?? []).map(async (row) => {
      const { data } = await supabase.storage
        .from('screenshots')
        .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS)
      return { ...row, url: data?.signedUrl ?? '' }
    })
  )

  return (
    <div className="page">
      <Link className="back" href="/contacts">
        ← All contacts
      </Link>

      <header className="detail-head">
        <div>
          <h1>{c.name}</h1>
          <div className="detail-meta">
            {c.address && <span>{c.address}</span>}
            {c.website && (
              <a href={c.website} target="_blank" rel="noreferrer">
                {c.website}
              </a>
            )}
            {c.instagram && (
              <a className="mono" href={instagramUrl(c.instagram)} target="_blank" rel="noreferrer">
                {c.instagram}
              </a>
            )}
            {c.phone && <span>{c.phone}</span>}
            {c.email && <span>{c.email}</span>}
          </div>
        </div>
        <div className="detail-badges">
          <CategoryTag value={c.category} />
          {c.is_new_venue && <NewVenueBadge />}
          <Rating value={c.rating} reviews={c.review_count} />
        </div>
      </header>

      <div className="detail-grid">
        <div className="col-main">
          <section className="panel">
            <div className="eyebrow">Instagram screenshots</div>
            <ScreenshotUpload
              contactId={c.id}
              screenshots={screenshots}
              uploadScreenshot={uploadScreenshot}
              deleteScreenshot={deleteScreenshot}
            />
          </section>

          <AnalysisPanel
            contactId={c.id}
            contactEmail={c.email}
            screenshotCount={screenshots.length}
            scoreBreakdown={c.score_breakdown}
            analysisSummary={c.analysis}
            priorityScore={c.priority_score}
            emails={{
              email_technical: c.email_technical,
              email_warm: c.email_warm,
              email_followup: c.email_followup,
            }}
            sentVariants={sentVariants}
            updateEmailVariant={updateEmailVariant}
            sendEmail={sendEmail}
          />

          <section className="panel">
            <div className="eyebrow">History</div>
            <NoteForm contactId={c.id} addNote={addNote} />
            <Timeline events={(events ?? []) as ContactEvent[]} />
          </section>
        </div>

        <aside className="col-side">
          <section className="panel">
            <div className="eyebrow">Contact status</div>
            <StatusSelect contactId={c.id} status={c.status} updateStatus={updateContactStatus} />
            <p className="hint dim">
              Changing the status records the date automatically and adds an entry to the history
              below.
            </p>
          </section>

          <section className="panel">
            <div className="eyebrow">Details</div>
            <dl className="detail-facts">
              <div>
                <dt className="dim">Type</dt>
                <dd>{c.business_type ?? '—'}</dd>
              </div>
              <div>
                <dt className="dim">Suburb</dt>
                <dd>{c.suburb ?? '—'}</dd>
              </div>
              <div>
                <dt className="dim">Source</dt>
                <dd>{c.source}</dd>
              </div>
              <div>
                <dt className="dim">Last contact</dt>
                <dd>{c.last_contact_date ?? '—'}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  )
}
