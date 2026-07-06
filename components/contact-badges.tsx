const STATUS_COLOR: Record<string, string> = {
  'To contact': '#8A919E',
  Contacted: '#5D9BD6',
  'No reply': '#DE9B3B',
  'In conversation': '#4CAF6E',
  'Not interested': '#D95F4E',
}

const CATEGORY_COLOR: Record<string, string> = {
  High: '#4CAF6E',
  Medium: '#DE9B3B',
  Low: '#D95F4E',
}

export function CategoryTag({ value }: { value: string }) {
  const color = CATEGORY_COLOR[value] ?? '#8A919E'
  return (
    <span className="cat-tag" style={{ color, borderColor: color + '55', background: color + '1A' }}>
      {value}
    </span>
  )
}

export function StatusDot({ value }: { value: string }) {
  const color = STATUS_COLOR[value] ?? '#8A919E'
  return (
    <span className="stato" style={{ color }}>
      <span className="stato-dot" style={{ background: color }} />
      {value}
    </span>
  )
}

export function NewVenueBadge() {
  return (
    <span className="cat-tag new-venue-tag" style={{ color: '#5D9BD6', borderColor: '#5D9BD655', background: '#5D9BD61A' }}>
      New venue
    </span>
  )
}

export function Rating({ value, reviews }: { value: number | null; reviews: number | null }) {
  if (value == null) return <span className="mono rating dim">—</span>
  return (
    <span className="mono rating">
      {value.toFixed(1)} {reviews != null && <span className="dim">/ {reviews}</span>}
    </span>
  )
}
