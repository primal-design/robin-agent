import type { JobMatch } from '../lib/types'
import { ProgressRing } from './ProgressRing'

interface Props { match: JobMatch; onApply?: (id: string) => void }

function fmtSalary(min?: number, max?: number, currency = 'GBP') {
  if (!min) return null
  const fmt = (n: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  return max ? `${fmt(min)} – ${fmt(max)}` : fmt(min)
}

export function JobCard({ match, onApply }: Props) {
  // Guard: backend may return flat rows — normalise defensively
  const raw = match as unknown as Record<string, unknown>
  const job: JobMatch['job'] = match.job ?? {
    id:         String(raw.job_id ?? ''),
    title:      String(raw.title  ?? ''),
    company:    String(raw.company ?? ''),
    location:   raw.location  as string | undefined,
    salary_min: raw.salary_min as number | undefined,
    salary_max: raw.salary_max as number | undefined,
    url:        raw.url as string | undefined,
  }
  const score          = match.score         ?? (raw.suitability_score as number) ?? 0
  const skill_matches  = match.skill_matches  ?? (raw.match_reasons    as string[]) ?? []
  const skill_gaps     = match.skill_gaps     ?? (raw.missing_skills   as string[]) ?? []
  const applied        = match.applied        ?? false
  const recommendation = match.recommendation ?? (raw.llm_summary      as string | undefined)
  const status         = match.status
  const salary = fmtSalary(job.salary_min, job.salary_max)

  if (!job?.title) return null

  return (
    <div className="card job-card" style={{ marginBottom: 14 }}>
      <div className="job-card-row">
        <div className="job-info">
          <div className="job-title">{job.title}</div>
          <div className="job-company">{job.company}</div>
          <div className="job-meta">
            {job.location && <span>{job.location}</span>}
            {salary       && <span>{salary}</span>}
            {job.source   && <span>via {job.source}</span>}
          </div>
          <div className="job-tags">
            {skill_matches.map(s => <span key={s} className="badge badge-success">{s}</span>)}
            {skill_gaps.map(s   => <span key={s} className="badge badge-danger">{s}</span>)}
          </div>
        </div>
        <ProgressRing value={score} />
      </div>

      {recommendation && (
        <p className="job-recommendation">
          {recommendation}
        </p>
      )}

      <div className="job-card-footer">
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
        ) : (
          job.url && job.url !== '#' ? <a href={job.url} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">Open listing →</a> : null
        )}
      </div>
    </div>
  )
}
