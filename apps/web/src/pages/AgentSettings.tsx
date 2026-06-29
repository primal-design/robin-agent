import { useEffect, useState } from 'react'
import type { UserProfile } from '../lib/types'
import { api } from '../lib/api'

const WORK_TYPES = ['remote', 'hybrid', 'onsite', 'any'] as const
const SENIORITIES = ['junior', 'mid', 'senior', 'lead', 'principal'] as const

export function AgentSettings() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [form, setForm] = useState<Partial<UserProfile>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [telegramToken, setTelegramToken] = useState('')
  const [genningToken, setGenningToken] = useState(false)

  useEffect(() => {
    api.getProfile().then(p => { setProfile(p); setForm(p) }).catch(e => setError(e.message))
  }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    try {
      const updated = await api.updateProfile(form)
      setProfile(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const genTelegramToken = async () => {
    setGenningToken(true)
    try {
      const { token } = await api.generateTelegramToken()
      setTelegramToken(token)
    } catch { /* ignore */ } finally {
      setGenningToken(false)
    }
  }

  const set = (k: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Configure your job search preferences.</p>
      </div>

      {error && <div className="error-box" style={{ marginBottom: 20 }}>{error}</div>}

      <form onSubmit={save} style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3 style={{ fontFamily: 'Georgia, serif' }}>Profile</h3>

          <div className="form-group">
            <label className="form-label">Full name</label>
            <input className="form-input" value={form.full_name ?? ''} onChange={set('full_name')} />
          </div>

          <div className="form-group">
            <label className="form-label">Headline</label>
            <input className="form-input" placeholder="e.g. Senior Full Stack Engineer" value={form.headline ?? ''} onChange={set('headline')} />
          </div>

          <div className="form-group">
            <label className="form-label">Location</label>
            <input className="form-input" placeholder="e.g. London, UK" value={form.location ?? ''} onChange={set('location')} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="form-group">
              <label className="form-label">Seniority</label>
              <select className="form-input" value={form.seniority ?? ''} onChange={set('seniority')}>
                <option value="">Select…</option>
                {SENIORITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Work type</label>
              <select className="form-input" value={form.work_type ?? ''} onChange={set('work_type') as React.ChangeEventHandler<HTMLSelectElement>}>
                <option value="">Select…</option>
                {WORK_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>
        </div>

        {saved && (
          <div style={{ padding: '10px 14px', background: 'var(--green-light)', borderRadius: 8, color: 'var(--green)', fontSize: 13 }}>
            Saved successfully.
          </div>
        )}

        <button type="submit" className="btn btn-primary" disabled={saving || !profile}>
          {saving ? <span className="spinner" /> : 'Save changes'}
        </button>
      </form>

      <div className="card" style={{ maxWidth: 520, marginTop: 24 }}>
        <h3 style={{ fontFamily: 'Georgia, serif', marginBottom: 12 }}>Connect Telegram</h3>
        <p className="text-sm text-muted" style={{ marginBottom: 16 }}>
          Get job matches and alerts sent directly to your Telegram account.
        </p>

        {telegramToken ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-input" style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--green)' }}>
              {telegramToken}
            </div>
            <p className="text-sm text-muted">
              Open your FEN Telegram bot and send: <code style={{ fontFamily: 'monospace' }}>/connect {telegramToken}</code>
            </p>
          </div>
        ) : (
          <button className="btn btn-outline" onClick={genTelegramToken} disabled={genningToken}>
            {genningToken ? <span className="spinner" /> : 'Generate connect code'}
          </button>
        )}
      </div>
    </div>
  )
}
