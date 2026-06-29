import { useEffect, useState } from 'react'
import type { TodayStats, JobMatch } from '../lib/types'
import { api } from '../lib/api'
import { StatCard } from '../components/StatCard'
import { JobCard } from '../components/JobCard'

export function Today() {
  const [stats, setStats] = useState<TodayStats | null>(null)
  const [matches, setMatches] = useState<JobMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([api.getStats(), api.getMatches()])
      .then(([s, m]) => { setStats(s); setMatches(m.slice(0, 3)) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-muted">Loading…</div>
  if (error)   return <div className="error-box">{error}</div>

  const nextScan = stats?.next_scan
    ? new Date(stats.next_scan).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Today</h1>
        <p className="page-subtitle">
          Your job search is running.
          {nextScan && ` Next scan at ${nextScan}.`}
        </p>
      </div>

      {stats && (
        <div className="card-grid" style={{ marginBottom: 32 }}>
          <StatCard value={stats.jobs_scanned.toLocaleString()} label="Jobs scanned" />
          <StatCard value={stats.matches_found} label="New matches" />
          <StatCard value={stats.applications_sent} label="Applications sent" />
          <StatCard value={stats.interviews} label="Interviews" />
        </div>
      )}

      {matches.length > 0 && (
        <>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: 18, marginBottom: 16 }}>Top matches today</h2>
          {matches.map(m => <JobCard key={m.id} match={m} />)}
          <a href="/app/matches" className="btn btn-outline btn-sm" style={{ marginTop: 8 }}>
            See all matches →
          </a>
        </>
      )}
    </div>
  )
}
