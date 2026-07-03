import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  async function login(formData: FormData) {
    'use server'
    const supabase = await createClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: formData.get('email') as string,
      password: formData.get('password') as string,
    })
    if (error) redirect('/login?error=1')
    redirect('/contacts')
  }

  return (
    <div className="login-wrap">
      <form className="login-box" action={login}>
        <h1 className="login-title">Prospect Engine</h1>
        {error && (
          <p className="login-error">Invalid email or password. Try again.</p>
        )}
        <label className="field">
          <span>Email</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
          />
        </label>
        <button className="btn-primary wide" type="submit">
          Sign in
        </button>
      </form>
    </div>
  )
}
