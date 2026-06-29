import { useEffect, useState } from 'react'
import type { TodayStats, JobMatch } from '../lib/types'
import { api } from '../lib/api'
import { JobCard } from '../components/JobCard'

export function Today() {
  const [stats, setStats]   = useState<TodayStats | null>(null)
  const [matches, setMatches] = useState<JobMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => {
    Promise.all([api.getStats(), api.getMatches()])
      .then(([s, m]) => { setStats(s); setMatches(m.slice(0, 3)) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-muted">Loading…</div>
  if (error)   return <div className="banner banner-danger">{error}</div>

  const nextScan = stats?.next_scan
    ? new Date(stats.next_scan).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Today</h1>
        <p className="page-sub">
          Your job search is running.
          {nextScan && ` Next scan at ${nextScan}.`}
        </p>
      </div>

      {stats && (
        <div className="card-grid" style={{ marginBottom: 32 }}>
          {[
            { value: stats.jobs_scanned.toLocaleString(), label: 'Jobs scanned' },
            { value: stats.matches_found,   label: 'New matches' },
            { value: stats.applications_sent, label: 'Applications' },
            { value: stats.interviews,       label: 'Interviews' },
          ].map(({ value, label }) => (
            <div key={label} className="metric-card">
              <div className="metric-value">{value}</div>
              <div className="metric-label">{label}</div>
            </div>
          ))}
        </div>
      )}

      {matches.length > 0 && (
        <>
          <h2 style={{ fontWeight: 600, marginBottom: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 12 }}>
            Top matches today
          </h2>
          {matches.map(m => <JobCard key={m.id} match={m} />)}
          <a href="/app/matches" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}>
            See all matches →
          </a>
        </>
      )}
    </div>
  )
}
