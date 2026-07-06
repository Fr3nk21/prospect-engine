import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(request: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json().catch(() => null)
  const location = (body?.location as string | undefined)?.trim()
  const business_type = (body?.business_type as string | undefined)?.trim()
  if (!location || !business_type) {
    return NextResponse.json({ error: 'location and business_type are required' }, { status: 422 })
  }

  const response = await fetch(`${process.env.SCRAPER_SERVICE_URL}/scrape`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SCRAPER_API_TOKEN}`,
    },
    body: JSON.stringify({ location, business_type }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    return NextResponse.json({ error: data?.detail ?? 'Scraper service error' }, { status: response.status })
  }

  return NextResponse.json(data)
}
