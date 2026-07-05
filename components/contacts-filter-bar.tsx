'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { CATEGORIES, STATUSES } from '@/lib/contacts'

export default function ContactsFilterBar({ types }: { types: string[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [search, setSearch] = useState(searchParams.get('q') ?? '')

  useEffect(() => {
    setSearch(searchParams.get('q') ?? '')
  }, [searchParams])

  function updateParams(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, value] of Object.entries(updates)) {
      if (value === null || value === '' || value === 'All') params.delete(key)
      else params.set(key, value)
    }
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  useEffect(() => {
    const current = searchParams.get('q') ?? ''
    if (search === current) return
    const timeout = setTimeout(() => updateParams({ q: search }), 350)
    return () => clearTimeout(timeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search])

  const category = searchParams.get('category') ?? 'All'
  const status = searchParams.get('status') ?? 'All'
  const type = searchParams.get('type') ?? 'All'
  const from = searchParams.get('from') ?? ''
  const to = searchParams.get('to') ?? ''

  const filtersActive = Boolean(search || category !== 'All' || status !== 'All' || type !== 'All' || from || to)

  return (
    <div className="filter-bar">
      <input
        type="search"
        placeholder="Search by name…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <select value={category} onChange={(e) => updateParams({ category: e.target.value })}>
        <option value="All">Category: all</option>
        {CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <select value={status} onChange={(e) => updateParams({ status: e.target.value })}>
        <option value="All">Status: all</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select value={type} onChange={(e) => updateParams({ type: e.target.value })}>
        <option value="All">Type: all</option>
        {types.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <label className="date-filter">
        <span className="dim">Last contact from</span>
        <input type="date" value={from} onChange={(e) => updateParams({ from: e.target.value })} />
      </label>
      <label className="date-filter">
        <span className="dim">to</span>
        <input type="date" value={to} onChange={(e) => updateParams({ to: e.target.value })} />
      </label>
      {filtersActive && (
        <button className="btn-ghost small" onClick={() => router.push(pathname)}>
          Clear filters
        </button>
      )}
    </div>
  )
}
