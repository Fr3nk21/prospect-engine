import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const response = await fetch(`${process.env.SCRAPER_SERVICE_URL}/analyze`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SCRAPER_API_TOKEN}`,
    },
    body: JSON.stringify({ contact_id: id }),
  })

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    return NextResponse.json({ error: data?.detail ?? 'Analysis service error' }, { status: response.status })
  }

  return NextResponse.json(data)
}
