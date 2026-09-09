import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ContactsFilterBar from '@/components/contacts-filter-bar'
import PageSizeSelect from '@/components/page-size-select'
import ContactsTable from '@/components/contacts-table'
import ScrapePanel from '@/components/scrape-panel'
import AddContactButton from '@/components/add-contact-button'
import { addContact } from './actions'
import { PAGE_SIZES, SORT_COLUMNS, type ContactListItem, type SortColumn } from '@/lib/contacts'

export const dynamic = 'force-dynamic'

function isSortColumn(value: string | undefined): value is SortColumn {
  return !!value && value in SORT_COLUMNS
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const sp = await searchParams

  const q = (sp.q ?? '').trim()
  const category = sp.category ?? 'All'
  const status = sp.status ?? 'All'
  const type = sp.type ?? 'All'
  const city = sp.city ?? 'All'
  const from = sp.from ?? ''
  const to = sp.to ?? ''
  const sort: SortColumn = isSortColumn(sp.sort) ? sp.sort : 'name'
  const dir = sp.dir === 'desc' ? 'desc' : 'asc'
  const pageSize = PAGE_SIZES.includes(Number(sp.pageSize) as (typeof PAGE_SIZES)[number])
    ? Number(sp.pageSize)
    : 10
  const page = Math.max(0, Number(sp.page) || 0)

  const overdue = sp.overdue === '1'
const overdueCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const supabase = await createClient()

  let query = supabase
    .from('contacts')
    .select(
      'id, name, suburb, business_type, rating, review_count, category, is_new_venue, status, last_contact_date, score_breakdown',
      { count: 'exact' }
    )

  if (q) query = query.ilike('name', `%${q}%`)
  if (category !== 'All') query = query.eq('category', category)
    if (overdue) {
    query = query.eq('status', 'Contacted').lte('last_contact_date', overdueCutoff)
  } else if (status !== 'All') {
    query = query.eq('status', status)
  }
  if (type !== 'All') query = query.eq('business_type', type)
  if (city !== 'All') query = query.eq('suburb', city)
  if (from) query = query.gte('last_contact_date', from)
  if (to) query = query.lte('last_contact_date', to)

  query = query.order(sort, { ascending: dir === 'asc' })

  const rangeFrom = page * pageSize
  const rangeTo = rangeFrom + pageSize - 1
  query = query.range(rangeFrom, rangeTo)

  // Prima fase: la query paginata, piu' le query indipendenti dagli id
  // (conteggi e valori per i filtri) — non hanno bisogno di sapere quali
  // contatti sono in questa pagina.
    const [
    { data: contacts, count: filteredCount },
    { count: totalCount },
    { count: toContactCount },
    { count: overdueCount },
    { data: typeRows },
    { data: suburbRows },
  ] = await Promise.all([
    query,
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('status', 'To contact'),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'Contacted')
      .lte('last_contact_date', overdueCutoff),
    supabase.from('contacts').select('business_type').not('business_type', 'is', null),
    supabase.from('contacts').select('suburb').not('suburb', 'is', null),
  ])

  const types = Array.from(new Set((typeRows ?? []).map((r) => r.business_type as string))).sort()
  const cities = Array.from(new Set((suburbRows ?? []).map((r) => r.suburb as string))).sort()

  // Seconda fase: ora che conosciamo gli id della pagina corrente,
  // scopiamo la query su screenshots solo a quei contatti — non piu'
  // sull'intera tabella.
  const pageIds = (contacts ?? []).map((c) => c.id as string)

  const { data: screenshotRows } =
    pageIds.length > 0
      ? await supabase.from('screenshots').select('contact_id').in('contact_id', pageIds)
      : { data: [] }

  const contactsWithScreenshots = new Set((screenshotRows ?? []).map((r) => r.contact_id as string))

  const rows: ContactListItem[] = (contacts ?? []).map((c) => {
    const id = c.id as string
    const sb = c.score_breakdown as { total_score?: number } | null
    return {
      id,
      name: c.name as string,
      suburb: c.suburb as string | null,
      business_type: c.business_type as string | null,
      rating: c.rating as number | null,
      review_count: c.review_count as number | null,
      category: c.category as string,
      is_new_venue: c.is_new_venue as boolean,
      status: c.status as string,
      last_contact_date: c.last_contact_date as string | null,
      has_screenshots: contactsWithScreenshots.has(id),
      instagram_score: sb?.total_score ?? null,
    }
  })

  const total = filteredCount ?? 0
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(page, pages - 1)

  const currentParams = new URLSearchParams()
  for (const [key, value] of Object.entries(sp)) if (value) currentParams.set(key, value)

  function hrefWith(updates: Record<string, string | number | null>) {
    const params = new URLSearchParams(currentParams)
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '') params.delete(key)
      else params.set(key, String(value))
    }
    return `/contacts?${params.toString()}`
  }

  function sortHref(column: SortColumn) {
    const nextDir = sort === column && dir === 'asc' ? 'desc' : 'asc'
    return hrefWith({ sort: column, dir: nextDir, page: null })
  }

  function arrow(column: SortColumn) {
    if (sort !== column) return ''
    return dir === 'asc' ? ' ↑' : ' ↓'
  }

  // Column order in the header: Business, IG, Category, Rating, Status, Last contact
  const sortableColumns = Object.keys(SORT_COLUMNS) as SortColumn[]

  return (
    <div className="page">
      <ScrapePanel />

      <section className="panel list-panel">
                <div className="list-head">
          <div>
            <div className="eyebrow">Contacts</div>
            <div className="list-count mono">
              {total} <span className="dim">of {totalCount ?? 0}</span>
              <span className="dim"> · {toContactCount ?? 0} to contact</span>
                            <span className="dim">
                {' · '}
                <Link href={hrefWith({ overdue: overdue ? null : '1', page: null })}>
                  {overdue ? '✓ ' : ''}{overdueCount ?? 0} contacted 7+ days ago
                </Link>
              </span>
            </div>
          </div>
          <AddContactButton addContact={addContact} />
        </div>

        <ContactsFilterBar types={types} cities={cities} />

        <ContactsTable
          rows={rows}
          headerCells={
            <>
              {/* Business */}
              <th className="sortable">
                <Link href={sortHref('name')}>
                  {SORT_COLUMNS['name']}{arrow('name')}
                </Link>
              </th>
              <th>Type</th>
              {/* IG — before Category */}
              <th className="center">IG</th>
              {/* Category */}
              <th className="sortable">
                <Link href={sortHref('category')}>
                  {SORT_COLUMNS['category']}{arrow('category')}
                </Link>
              </th>
              {/* Rating — dimmed header to match the dimmed cell */}
              <th className="right sortable" style={{ opacity: 0.45 }}>
                <Link href={sortHref('rating')}>
                  {SORT_COLUMNS['rating']}{arrow('rating')}
                </Link>
              </th>
              {/* Status */}
              <th className="sortable">
                <Link href={sortHref('status')}>
                  {SORT_COLUMNS['status']}{arrow('status')}
                </Link>
              </th>
              {/* Last contact */}
              <th className="right sortable">
                <Link href={sortHref('last_contact_date')}>
                  {SORT_COLUMNS['last_contact_date']}{arrow('last_contact_date')}
                </Link>
              </th>
            </>
          }
        />

        <div className="pager">
          <PageSizeSelect current={pageSize} />
          <div className="pager-nav">
            {safePage > 0 ? (
              <Link className="btn-ghost small" href={hrefWith({ page: safePage - 1 })}>
                ← Prev
              </Link>
            ) : (
              <span className="btn-ghost small disabled">← Prev</span>
            )}
            <span className="mono dim">
              Page {safePage + 1} of {pages}
            </span>
            {safePage < pages - 1 ? (
              <Link className="btn-ghost small" href={hrefWith({ page: safePage + 1 })}>
                Next →
              </Link>
            ) : (
              <span className="btn-ghost small disabled">Next →</span>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}