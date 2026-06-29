import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useAuth } from '../lib/auth'

export function AuthCallback() {
  const [params] = useSearchParams()
  const { setTokenFromCallback } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState('')

  useEffect(() => {
    const token = params.get('token')
    if (!token) { setError('No token found in URL'); return }

    setTokenFromCallback(token)
      .then(() => navigate('/app/today', { replace: true }))
      .catch(e => setError(e instanceof Error ? e.message : 'Auth failed'))
  }, [])

  if (error) return (
    <div className="auth-page">
      <div className="card auth-card">
        <div className="error-box">{error}</div>
        <a href="/sign-in" className="btn btn-outline w-full" style={{ marginTop: 16 }}>Back to sign in</a>
      </div>
    </div>
  )

  return (
    <div className="auth-page">
      <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        Signing you in…
      </div>
    </div>
  )
}
