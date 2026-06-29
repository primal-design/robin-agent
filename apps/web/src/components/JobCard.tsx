import type { JobMatch } from '../lib/types'
import { ProgressRing } from './ProgressRing'

interface Props { match: JobMatch; onApply?: (id: string) => void }

function fmtSalary(min?: number, max?: number, currency = 'GBP') {
  if (!min) return null
  const fmt = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  return max ? `${fmt(min)} – ${fmt(max)}` : fmt(min)
}

export function JobCard({ match, onApply }: Props) {
  const { job, score, skill_matches, skill_gaps, applied, recommendation, status } = match
  const salary = fmtSalary(job.salary_min, job.salary_max, job.salary_currency)

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="job-card-row">
        <div className="job-info">
          <div className="job-title">{job.title}</div>
          <div className="job-company">{job.company}</div>
          <div className="job-meta">
            {job.location && <span>{job.location}</span>}
            {salary     && <span>{salary}</span>}
            {job.source && <span>via {job.source}</span>}
          </div>
          <div className="job-tags">
            {skill_matches.map(s => <span key={s} className="badge badge-success">{s}</span>)}
            {skill_gaps.map(s   => <span key={s} className="badge badge-danger">{s}</span>)}
          </div>
        </div>
        <ProgressRing value={score} />
      </div>

      {recommendation && (
        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 12, lineHeight: 1.6 }}>
          {recommendation}
        </p>
      )}

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
        {applied ? (
          <>
            <span className="badge badge-success">Applied</span>
            {status === 'interview' && <span className="badge badge-warning">Interview</span>}
            {status === 'offer'     && <span className="badge badge-accent">Offer</span>}
          </>
        ) : onApply ? (
          <>
            <button className="btn btn-primary btn-sm" onClick={() => onApply(match.id)}>Apply</button>
            {job.url && job.url !== '#' && (
              <a href={job.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">View →</a>
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}
