'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function Topbar() {
  const router = useRouter()
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    const saved = localStorage.getItem('pe-theme') as 'dark' | 'light' | null
    if (saved) applyTheme(saved)
  }, [])

  function applyTheme(t: 'dark' | 'light') {
    setTheme(t)
    localStorage.setItem('pe-theme', t)
    document.documentElement.setAttribute('data-theme', t === 'light' ? 'light' : '')
  }

  async function logout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <nav className="topbar">
      <Link href="/contacts" className="brand">
        Prospect Engine
      </Link>
      <div className="topbar-right">
        <button
          className="btn-ghost small theme-toggle"
          onClick={() => applyTheme(theme === 'dark' ? 'light' : 'dark')}
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? '☀ Light' : '☾ Dark'}
        </button>
        <button className="btn-ghost small" onClick={logout}>
          Sign out
        </button>
      </div>
    </nav>
  )
}
