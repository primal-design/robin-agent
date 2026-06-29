import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { Upload } from 'lucide-react'
import type { TodayStats, JobMatch } from '../lib/types'
import { api } from '../lib/api'
import { JobCard } from '../components/JobCard'

export function Today() {
  const [stats, setStats]     = useState<TodayStats | null>(null)
  const [matches, setMatches] = useState<JobMatch[]>([])
  const [noProfile, setNoProfile] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getStats(), api.getMatches()])
      .then(([s, m]) => { setStats(s); setMatches(m.slice(0, 3)) })
      .catch(e => {
        // 404 means no CV uploaded yet
        if (e.message?.includes('404')) setNoProfile(true)
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-muted" style={{ padding: 8 }}>Loading…</div>

  if (noProfile) return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Welcome to FEN</h1>
        <p className="page-sub">Upload your CV to get started.</p>
      </div>
      <div className="card" style={{ maxWidth: 480 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 20px', gap: 16, textAlign: 'center' }}>
          <Upload size={36} strokeWidth={1.5} style={{ color: 'var(--text-faint)' }} />
          <div>
            <h3 style={{ marginBottom: 6 }}>No profile yet</h3>
            <p className="text-sm text-muted">FEN needs your CV to start matching jobs. It takes about 30 seconds.</p>
          </div>
          <Link to="/app/cv-lab" className="btn btn-primary">Upload CV →</Link>
        </div>
      </div>
    </div>
  )

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
            { value: stats.matches_found,    label: 'New matches' },
            { value: stats.applications_sent, label: 'Applications' },
            { value: stats.interviews,        label: 'Interviews' },
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
          <Link to="/app/matches" className="btn btn-secondary btn-sm" style={{ marginTop: 8 }}>
            See all matches →
          </Link>
        </>
      )}

      {matches.length === 0 && !noProfile && (
        <div className="card" style={{ maxWidth: 480 }}>
          <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p>No matches yet — FEN is scanning jobs for your profile.</p>
            <p className="text-sm" style={{ marginTop: 6 }}>Check back soon or trigger a scan from Matches.</p>
          </div>
        </div>
      )}
    </div>
  )
}
