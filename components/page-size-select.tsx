'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { PAGE_SIZES } from '@/lib/contacts'

export default function PageSizeSelect({ current }: { current: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('pageSize', value)
    params.delete('page')
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <label className="pager-size">
      <span className="dim">Rows per page</span>
      <select value={current} onChange={(e) => onChange(e.target.value)}>
        {PAGE_SIZES.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
    </label>
  )
}
