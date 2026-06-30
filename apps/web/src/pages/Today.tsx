import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, FileText, Search, Upload } from 'lucide-react'
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
        <p className="page-sub">Start with one CV upload and FEN will handle profile building, matching, and review from there.</p>
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
          Keep the essentials close: profile status, fresh matches, and the next action to take.
          {nextScan && ` Next scan at ${nextScan}.`}
        </p>
      </div>

      <div className="card hero-card">
        <div className="hero-card-copy">
          <div className="hero-eyebrow">Daily overview</div>
          <h2 className="hero-title">Your search is active and ready for the next step.</h2>
          <p className="hero-body">
            Review fresh matches, upload an updated CV, or trigger a new scan when you want a cleaner pass across the latest openings.
          </p>
          <div className="hero-actions">
            <Link to="/app/matches" className="btn btn-primary">
              <Search size={16} strokeWidth={2} />
              Review matches
            </Link>
            <Link to="/app/cv-lab" className="btn btn-secondary">
              <FileText size={16} strokeWidth={2} />
              Manage CV
            </Link>
          </div>
        </div>

        <div className="hero-aside">
          <div className="hero-highlight">
            <div className="hero-highlight-value">{stats?.matches_found ?? 0}</div>
            <div className="hero-highlight-label">current matches available to review</div>
          </div>
          <div className="card-tinted">
            <div className="section-title" style={{ marginBottom: 8 }}>Next best action</div>
            <p className="text-sm text-muted">
              {matches.length > 0
                ? 'Open your strongest matches first and work down the list while everything is fresh.'
                : 'If your results feel stale, run another scan after updating your CV or target role.'}
            </p>
          </div>
        </div>
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
          <div className="section-header">
            <h2 className="section-title">Top matches today</h2>
            <Link to="/app/matches" className="btn btn-secondary btn-sm">
              See all matches <ArrowRight size={14} strokeWidth={2} />
            </Link>
          </div>
          {matches.map(m => <JobCard key={m.id} match={m} />)}
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
