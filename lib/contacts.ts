export const STATUSES = [
  'To contact',
  'Contacted',
  'No reply',
  'In conversation',
  'Not interested',
  'To recontact',
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
  has_screenshots: boolean
  instagram_score: number | null  // total_score from score_breakdown, null if no analysis
}
export type ScoreDimension = {
  key: string
  label: string
  max: number
  score: number
  note: string
}
export type ScoreBreakdown = {
  dimensions: ScoreDimension[]
  total_score: number
  total_max: number
  has_videographer: 'yes' | 'no' | 'unclear'
}
export type EmailVariant = 'email_technical' | 'email_warm' | 'email_followup'
export type AnalysisJob = {
  id: string
  contact_id: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  error: string | null
  started_at: string | null
  finished_at: string | null
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
  priority_score: number | null
  score_breakdown: ScoreBreakdown | null
  analysis: string | null
  email_technical: string | null
  email_warm: string | null
  email_followup: string | null
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
export type Screenshot = {
  id: string
  contact_id: string
  storage_path: string
  created_at: string
  url: string
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