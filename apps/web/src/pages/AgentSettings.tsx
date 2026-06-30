import { useEffect, useState } from 'react'
import type { UserProfile } from '../lib/types'
import { api } from '../lib/api'

const WORK_TYPES  = ['remote', 'hybrid', 'onsite', 'any'] as const
const SENIORITIES = ['junior', 'mid', 'senior', 'lead', 'principal'] as const

export function AgentSettings() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [form, setForm]       = useState<Partial<UserProfile>>({})
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState('')
  const [telegramToken, setTelegramToken] = useState('')
  const [genningToken, setGenningToken]   = useState(false)

  useEffect(() => {
    api.getProfile().then(p => {
      setProfile(p)
      setForm(p ?? {})
    }).catch(e => setError(e.message))
  }, [])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true); setSaved(false)
    try {
      const updated = await api.updateProfile(form)
      setProfile(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const genToken = async () => {
    setGenningToken(true)
    try { const { token } = await api.generateTelegramToken(); setTelegramToken(token) }
    catch { /* ignore */ } finally { setGenningToken(false) }
  }

  const set = (k: keyof UserProfile) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
        <p className="page-sub">Configure your job search preferences.</p>
      </div>

      {error && <div className="banner banner-danger mb-4">{error}</div>}

      <form onSubmit={save} style={{ maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h3>Profile</h3>

          <div className="field">
            <label className="field-label">Full name</label>
            <input className="field-input" value={form.full_name ?? ''} onChange={set('full_name')} />
          </div>

          <div className="field">
            <label className="field-label">Headline</label>
            <input className="field-input" placeholder="e.g. Senior Full Stack Engineer" value={form.headline ?? ''} onChange={set('headline')} />
          </div>

          <div className="field">
            <label className="field-label">Location</label>
            <input className="field-input" placeholder="e.g. London, UK" value={form.location ?? ''} onChange={set('location')} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="field">
              <label className="field-label">Seniority</label>
              <select className="field-select" value={form.seniority ?? ''} onChange={set('seniority')}>
                <option value="">Select…</option>
                {SENIORITIES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field-label">Work type</label>
              <select className="field-select" value={form.work_type ?? ''} onChange={set('work_type') as React.ChangeEventHandler<HTMLSelectElement>}>
                <option value="">Select…</option>
                {WORK_TYPES.map(t => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
              </select>
            </div>
          </div>
        </div>

        {saved && <div className="banner banner-success">Saved.</div>}

        <button type="submit" className="btn btn-primary" disabled={saving || !profile}>
          {saving ? <span className="spinner" /> : 'Save changes'}
        </button>
      </form>

      <div className="card" style={{ maxWidth: 520, marginTop: 24 }}>
        <h3 style={{ marginBottom: 4 }}>Connect Telegram</h3>
        <p className="text-sm text-muted" style={{ marginBottom: 16 }}>
          Receive job matches and alerts in Telegram.
        </p>

        {telegramToken ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="field-input" style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--success)' }}>
              {telegramToken}
            </div>
            <p className="text-sm text-muted">
              Open the FEN bot and send: <code style={{ fontFamily: 'monospace', fontSize: 12 }}>/connect {telegramToken}</code>
            </p>
          </div>
        ) : (
          <button className="btn btn-secondary" onClick={genToken} disabled={genningToken}>
            {genningToken ? <span className="spinner" /> : 'Generate connect code'}
          </button>
        )}
      </div>
    </div>
  )
}
