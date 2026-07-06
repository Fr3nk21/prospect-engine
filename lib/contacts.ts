export const STATUSES = [
  'To contact',
  'Contacted',
  'No reply',
  'In conversation',
  'Not interested',
] as const

export const CATEGORIES = ['High', 'Medium', 'Low'] as const

export const PAGE_SIZES = [5, 10, 25] as const

export const SORT_COLUMNS = {
  name: 'Business',
  category: 'Category',
  rating: 'Rating',
  status: 'Status',
  last_contact_date: 'Last contact',
} as const

export type SortColumn = keyof typeof SORT_COLUMNS

export type ContactListItem = {
  id: string
  name: string
  suburb: string | null
  business_type: string | null
  rating: number | null
  review_count: number | null
  category: string
  is_new_venue: boolean
  status: string
  last_contact_date: string | null
}

export type ContactDetail = {
  id: string
  place_id: string | null
  name: string
  address: string | null
  suburb: string | null
  phone: string | null
  website: string | null
  email: string | null
  instagram: string | null
  business_type: string | null
  rating: number | null
  review_count: number | null
  category: string
  is_new_venue: boolean
  status: string
  last_contact_date: string | null
  source: string
}

export type ScrapeJob = {
  id: string
  location: string
  business_type: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  total: number | null
  processed: number
  new_contacts: number
  skipped: number
  error: string | null
  started_at: string | null
  finished_at: string | null
}

export type ContactEvent = {
  id: string
  contact_id: string
  type: 'status_change' | 'note' | 'email_sent' | 'email_reply' | 'analysis' | 'import' | 'system'
  old_status: string | null
  new_status: string | null
  email_variant: 'technical' | 'warm' | 'followup' | null
  body: string | null
  created_at: string
}

export function instagramUrl(value: string): string {
  const handle = value.trim().replace(/^@/, '')
  if (/^https?:\/\//i.test(handle)) return handle
  return `https://instagram.com/${handle.replace(/^instagram\.com\//i, '')}`
}

export const HISTORY_ICON: Record<ContactEvent['type'], string> = {
  status_change: '⇄',
  note: '✎',
  email_sent: '✉',
  email_reply: '↩',
  analysis: '◎',
  import: '⇩',
  system: '●',
}
