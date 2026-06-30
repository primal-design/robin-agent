import { useEffect, useState } from 'react'
import { ClipboardList } from 'lucide-react'
import type { JobMatch } from '../lib/types'
import { api } from '../lib/api'

function statusBadge(status: string) {
  const map: Record<string, string> = {
    applied:   'badge-neutral',
    interview: 'badge-warning',
    offer:     'badge-success',
    rejected:  'badge-danger',
  }
  return map[status] ?? 'badge-neutral'
}

export function Applications() {
  const [apps, setApps]     = useState<JobMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => {
    api.getApplications().then(setApps).catch(e => setError(e.message)).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-muted">Loading…</div>
  if (error)   return <div className="banner banner-danger">{error}</div>

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Applications</h1>
        <p className="page-sub">{apps.length} application{apps.length !== 1 ? 's' : ''} tracked</p>
      </div>

      {apps.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><ClipboardList size={32} strokeWidth={1.5} /></div>
          <h3>No applications yet</h3>
          <p>Apply to jobs from your matches and they'll appear here.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {apps.map(a => (
            <div key={a.id} className="card" style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <div className="score-chip score-chip-sm">{a.score}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="job-title">{a.job.title}</div>
                <div className="job-company">{a.job.company}{a.job.location ? ` · ${a.job.location}` : ''}</div>
                {a.applied_at && (
                  <div className="text-xs text-muted" style={{ marginTop: 2 }}>
                    Applied {new Date(a.applied_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                  </div>
                )}
              </div>
              {a.status && (
                <span className={`badge ${statusBadge(a.status)}`}>
                  {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
