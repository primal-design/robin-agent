import { useState } from 'react'
import { useAuth } from '../lib/auth'

export function SignIn() {
  const { signIn } = useAuth()
  const [email, setEmail]   = useState('')
  const [sent, setSent]     = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]   = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true); setError('')
    try { await signIn(email.trim()); setSent(true) }
    catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong') }
    finally { setLoading(false) }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card auth-panel-grid">
        <div>
          <div className="hero-eyebrow">Sign in</div>
          <h1>Pick up your search without the clutter.</h1>
          <p className="auth-sub">Use your email and FEN will send a secure magic link. No password, no extra setup, no confusing dashboard first.</p>

          {sent ? (
            <div className="card-tinted" style={{ textAlign: 'center', padding: '24px 20px' }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📬</div>
              <h3 style={{ marginBottom: 8 }}>Check your inbox</h3>
              <p className="text-muted text-sm">Sent a sign-in link to <strong>{email}</strong></p>
            </div>
          ) : (
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {error && <div className="banner banner-danger">{error}</div>}
              <div className="field">
                <label className="field-label">Email address</label>
                <input
                  type="email"
                  className="field-input"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  autoFocus
                />
              </div>
              <button type="submit" className="btn btn-primary w-full" disabled={loading}>
                {loading ? <span className="spinner" /> : 'Send magic link'}
              </button>
            </form>
          )}
        </div>

        <div className="card-tinted surface-stack">
          <div className="section-title">What happens next</div>
          <div>
            <h3 style={{ fontSize: 18, marginBottom: 6 }}>A cleaner first-run flow</h3>
            <p className="text-sm text-muted">New users go straight into CV upload and onboarding instead of landing in a half-ready dashboard.</p>
          </div>
          <div>
            <h3 style={{ fontSize: 18, marginBottom: 6 }}>One candidate at a time</h3>
            <p className="text-sm text-muted">Replace or clear a candidate from CV Lab when you want to start fresh with a different profile.</p>
          </div>
        </div>
      </div>
    </div>
  )
}
