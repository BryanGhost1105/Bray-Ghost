'use client'

import { FormEvent, useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const router = useRouter()
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')

    const response = await fetch('/api/auth/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })

    if (response.ok) {
      router.replace('/')
      router.refresh()
    } else {
      const data = await response.json().catch(() => ({}))
      setError(data.error || 'Unable to sign in.')
    }
    setLoading(false)
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-24 text-slate-100">
      <form onSubmit={submit} className="mx-auto max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">Coldstart</p>
        <h1 className="mb-2 text-2xl font-semibold">Internal workspace</h1>
        <p className="mb-8 text-sm text-slate-400">Enter the APP_ACCESS_TOKEN configured for this private instance.</p>
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="Access token"
          autoComplete="current-password"
          className="mb-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-sm outline-none focus:border-cyan-400"
        />
        {error && <p className="mb-4 text-sm text-rose-400">{error}</p>}
        <button disabled={loading || !token} className="w-full rounded-lg bg-cyan-500 px-4 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50">
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
