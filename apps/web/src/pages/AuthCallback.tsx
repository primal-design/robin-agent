import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../lib/auth'
import { api } from '../lib/api'

export function AuthCallback() {
  const [params]  = useSearchParams()
  const { setTokenFromCallback } = useAuth()
  const navigate  = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    const token = params.get('token')
    const name  = params.get('name') ?? ''
    if (!token) { setError('No token in URL — try signing in again.'); return }
    setTokenFromCallback(token, name)
      .then(async () => {
        const profile = await api.getProfile()
        navigate(profile ? '/app/matches' : '/app/onboarding', { replace: true })
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Auth failed'))
  }, [])

  if (error) return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="banner banner-danger" style={{ marginBottom: 16 }}>{error}</div>
        <a href="/sign-in" className="btn btn-secondary w-full">Back to sign in</a>
      </div>
    </div>
  )

  return (
    <div className="auth-page">
      <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        Signing you in…
      </div>
    </div>
  )
}
