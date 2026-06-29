import { useEffect, useState } from 'react'
import type { JobMatch } from '../lib/types'
import { api } from '../lib/api'
import { ScoreRing } from '../components/ScoreRing'

function stageLabel(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function stageColor(s: string): string {
  if (s === 'offer')    return 'var(--green)'
  if (s === 'interview') return 'var(--amber)'
  if (s === 'rejected') return 'var(--red)'
  return 'var(--muted)'
}

export function Applications() {
  const [apps, setApps] = useState<JobMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api.getApplications()
      .then(setApps)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-muted">Loading…</div>
  if (error)   return <div className="error-box">{error}</div>

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Applications</h1>
        <p className="page-subtitle">{apps.length} application{apps.length !== 1 ? 's' : ''} tracked</p>
      </div>

      {apps.length === 0 ? (
        <div className="empty-state">
          <h3>No applications yet</h3>
          <p>Apply to jobs from your matches and they'll appear here.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {apps.map(a => (
            <div key={a.id} className="card" style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
              <ScoreRing score={a.score} size={44} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{a.job.title}</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>{a.job.company} · {a.job.location}</div>
                {a.applied_at && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                    Applied {new Date(a.applied_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </div>
                )}
              </div>
              {a.status && (
                <span className="pill" style={{
                  background: `${stageColor(a.status)}20`,
                  color: stageColor(a.status),
                  border: `1px solid ${stageColor(a.status)}40`,
                }}>
                  {stageLabel(a.status)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
