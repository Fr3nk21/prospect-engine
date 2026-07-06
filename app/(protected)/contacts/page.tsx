import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import ContactsFilterBar from '@/components/contacts-filter-bar'
import PageSizeSelect from '@/components/page-size-select'
import ContactRow from '@/components/contact-row'
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
  if (from) query = query.gte('last_contact_date', from)
  if (to) query = query.lte('last_contact_date', to)

  query = query.order(sort, { ascending: dir === 'asc' })

  const rangeFrom = page * pageSize
  const rangeTo = rangeFrom + pageSize - 1
  query = query.range(rangeFrom, rangeTo)

  const [{ data: contacts, count: filteredCount }, { count: totalCount }, { count: toContactCount }, { data: typeRows }] =
    await Promise.all([
      query,
      supabase.from('contacts').select('id', { count: 'exact', head: true }),
      supabase.from('contacts').select('id', { count: 'exact', head: true }).eq('status', 'To contact'),
      supabase.from('contacts').select('business_type').not('business_type', 'is', null),
    ])

  const types = Array.from(new Set((typeRows ?? []).map((r) => r.business_type as string))).sort()

  const rows = (contacts ?? []) as ContactListItem[]
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

        <ContactsFilterBar types={types} />

        <table className="contacts">
          <thead>
            <tr>
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
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <ContactRow key={c.id} contact={c} />
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="empty">
                  No contacts match these filters. Try widening them.
                </td>
              </tr>
            )}
          </tbody>
        </table>

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
