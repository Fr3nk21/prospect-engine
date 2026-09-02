import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ContactsFilterBar from '@/components/contacts-filter-bar'
import PageSizeSelect from '@/components/page-size-select'
import ContactsTable from '@/components/contacts-table'
import ScrapePanel from '@/components/scrape-panel'
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

  const supabase = await createClient()

  let query = supabase
    .from('contacts')
    .select(
      'id, name, suburb, business_type, rating, review_count, category, is_new_venue, status, last_contact_date',
      { count: 'exact' }
    )

  if (q) query = query.ilike('name', `%${q}%`)
  if (category !== 'All') query = query.eq('category', category)
  if (status !== 'All') query = query.eq('status', status)
  if (type !== 'All') query = query.eq('business_type', type)
  if (city !== 'All') query = query.eq('suburb', city)
  if (from) query = query.gte('last_contact_date', from)
  if (to) query = query.lte('last_contact_date', to)

  query = query.order(sort, { ascending: dir === 'asc' })

  const rangeFrom = page * pageSize
  const rangeTo = rangeFrom + pageSize - 1
  query = query.range(rangeFrom, rangeTo)

  const [
    { data: contacts, count: filteredCount },
    { count: totalCount },
    { count: toContactCount },
    { data: typeRows },
    { data: suburbRows },
    { data: screenshotRows },
    { data: analysisRows },
  ] = await Promise.all([
    query,
    supabase.from('contacts').select('id', { count: 'exact', head: true }),
    supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('status', 'To contact'),
    supabase.from('contacts').select('business_type').not('business_type', 'is', null),
    supabase.from('contacts').select('suburb').not('suburb', 'is', null),
    // contact_ids that have at least one screenshot
    supabase.from('screenshots').select('contact_id'),
    // completed analyses with the total_score extracted from score_breakdown JSON
    supabase
      .from('analysis_jobs')
      .select('contact_id')
      .eq('status', 'completed'),
  ])

  const types = Array.from(new Set((typeRows ?? []).map((r) => r.business_type as string))).sort()
  const cities = Array.from(new Set((suburbRows ?? []).map((r) => r.suburb as string))).sort()

  // Build sets/maps for O(1) lookup per row
  const contactsWithScreenshots = new Set((screenshotRows ?? []).map((r) => r.contact_id as string))
  const analysedContactIds = new Set((analysisRows ?? []).map((r) => r.contact_id as string))

  // For contacts that have a completed analysis, fetch the instagram score
  // directly from the contacts table (score_breakdown->total_score)
  let scoreMap = new Map<string, number>()
  if (analysedContactIds.size > 0) {
    const ids = Array.from(analysedContactIds)
    const { data: scoreRows } = await supabase
      .from('contacts')
      .select('id, score_breakdown')
      .in('id', ids)
      .not('score_breakdown', 'is', null)

    for (const row of scoreRows ?? []) {
      const sb = row.score_breakdown as { total_score?: number } | null
      if (sb?.total_score != null) {
        scoreMap.set(row.id, sb.total_score)
      }
    }
  }

  const rows: ContactListItem[] = (contacts ?? []).map((c) => {
  const id = c.id as string
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
    instagram_score: scoreMap.get(id) ?? null,
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
            </div>
          </div>
        </div>

        <ContactsFilterBar types={types} cities={cities} />

        <ContactsTable
          rows={rows}
          headerCells={
            <>
              {(Object.keys(SORT_COLUMNS) as SortColumn[]).map((column) => (
                <th
                  key={column}
                  className={column === 'rating' || column === 'last_contact_date' ? 'right sortable' : 'sortable'}
                >
                  <Link href={sortHref(column)}>
                    {SORT_COLUMNS[column]}
                    {arrow(column)}
                  </Link>
                </th>
              ))}
              <th className="center">IG</th>
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