import type { JobMatch } from '../lib/types'
import { ScoreRing } from './ScoreRing'

interface Props { match: JobMatch; onApply?: (id: string) => void }

function fmt(n?: number, currency = 'GBP') {
  if (!n) return null
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

export function JobCard({ match, onApply }: Props) {
  const { job, score, skill_matches, skill_gaps, applied, recommendation } = match
  const salaryMin = fmt(job.salary_min, job.salary_currency)
  const salaryMax = fmt(job.salary_max, job.salary_currency)
  const salary = salaryMin ? `${salaryMin}${salaryMax ? ` – ${salaryMax}` : ''}` : null

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="job-card">
        <div className="job-info">
          <div className="job-title">{job.title}</div>
          <div className="job-company">{job.company}</div>
          <div className="job-meta">
            {job.location && <span>{job.location}</span>}
            {salary && <span>{salary}</span>}
            {job.source && <span>via {job.source}</span>}
          </div>
          <div className="job-skills">
            {skill_matches.map(s => <span key={s} className="pill pill-green">{s}</span>)}
            {skill_gaps.map(s => <span key={s} className="pill pill-red">{s}</span>)}
          </div>
        </div>
        <ScoreRing score={score} />
      </div>

      {recommendation && (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {recommendation}
        </p>
      )}

      {!applied && onApply && (
        <div style={{ marginTop: 14 }}>
          <button className="btn btn-primary btn-sm" onClick={() => onApply(match.id)}>Apply</button>
          {job.url && job.url !== '#' && (
            <a href={job.url} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" style={{ marginLeft: 8 }}>
              View →
            </a>
          )}
        </div>
      )}

      {applied && (
        <div style={{ marginTop: 12 }}>
          <span className="pill pill-green">Applied</span>
          {match.status === 'interview' && <span className="pill pill-amber" style={{ marginLeft: 6 }}>Interview</span>}
        </div>
      )}
    </div>
  )
}
