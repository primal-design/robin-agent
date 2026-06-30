import { useState } from 'react'
import { Brain, Building2, ChevronDown, ChevronUp, CheckCircle, XCircle, AlertCircle } from 'lucide-react'

interface Improvement { priority: 'high' | 'medium' | 'low'; action: string }
interface InhouseFeedback {
  verdict: string
  first_impression: string
  strengths: string[]
  weaknesses: string[]
  improvements: Improvement[]
  would_call: boolean
}
interface AgencyFeedback {
  ats_score: number
  ats_issues: string[]
  keyword_hits: string[]
  keyword_gaps: string[]
  marketability: string
  quick_wins: string[]
}
interface ReviewResult {
  inhouse: InhouseFeedback
  agency: AgencyFeedback
}

function priorityColor(p: string) {
  if (p === 'high')   return 'badge-danger'
  if (p === 'medium') return 'badge-warning'
  return 'badge-neutral'
}

function ATSRing({ score }: { score: number }) {
  const size = 80, sw = 7
  const r    = (size - sw) / 2
  const circ = 2 * Math.PI * r
  const fill = (score / 100) * circ
  const color = score >= 70 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)'
  return (
    <div style={{ position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--surface-1)" strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw}
          strokeDasharray={`${fill} ${circ}`} strokeLinecap="round" />
      </svg>
      <div style={{ position: 'absolute', fontWeight: 700, fontSize: 18, color }}>
        {score}
      </div>
    </div>
  )
}

function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && <div style={{ marginTop: 12 }}>{children}</div>}
    </div>
  )
}

function BulletList({ items, variant = 'neutral' }: { items: string[]; variant?: 'success' | 'danger' | 'neutral' }) {
  const icon = variant === 'success' ? <CheckCircle size={14} style={{ color: 'var(--success)', flexShrink: 0 }} />
             : variant === 'danger'  ? <XCircle    size={14} style={{ color: 'var(--danger)',  flexShrink: 0 }} />
             : <AlertCircle          size={14} style={{ color: 'var(--warning)', flexShrink: 0 }} />
  return (
    <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }}>
          <span style={{ marginTop: 2 }}>{icon}</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

export function CVReview() {
  const [result, setResult]   = useState<ReviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const runReview = async () => {
    setLoading(true)
    setError('')
    try {
      const token = localStorage.getItem('fen_token')
      const res = await fetch('/cv/review', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error((j as { message?: string }).message ?? `${res.status}`)
      }
      setResult(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Review failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">CV Review</h1>
        <p className="page-sub">Two AI recruiters with 20 years experience review your CV in parallel.</p>
      </div>

      {!result && !loading && (
        <div className="card" style={{ maxWidth: 540 }}>
          <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
            <div style={{ flex: 1, padding: '16px', background: 'var(--surface-1)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Brain size={18} style={{ color: 'var(--accent)' }} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>Claude Opus 4.8</span>
              </div>
              <p className="text-sm text-muted">Senior in-house recruiter & hiring manager. Would they call you?</p>
            </div>
            <div style={{ flex: 1, padding: '16px', background: 'var(--surface-1)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <Building2 size={18} style={{ color: 'var(--success)' }} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>GPT-4o</span>
              </div>
              <p className="text-sm text-muted">Agency recruiter. ATS score, keyword gaps, marketability.</p>
            </div>
          </div>
          {error && <div className="banner banner-danger" style={{ marginBottom: 16 }}>{error}</div>}
          <button className="btn btn-primary w-full" onClick={runReview}>
            Run CV Review — takes ~20 seconds
          </button>
        </div>
      )}

      {loading && (
        <div className="card" style={{ maxWidth: 540, textAlign: 'center', padding: '48px 24px' }}>
          <div className="spinner" style={{ margin: '0 auto 16px', width: 28, height: 28 }} />
          <div style={{ fontWeight: 500 }}>Two AI recruiters are reading your CV…</div>
          <p className="text-sm text-muted" style={{ marginTop: 6 }}>Claude Opus + GPT-4o running in parallel. ~20 seconds.</p>
        </div>
      )}

      {result && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 1000 }}>

          {/* ── Claude — In-house recruiter ── */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Brain size={16} style={{ color: 'var(--accent)' }} />
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent)' }}>Claude Opus · In-house Recruiter</span>
            </div>

            <div style={{ padding: '12px', background: result.inhouse.would_call ? 'var(--success-light)' : 'var(--danger-light)', borderRadius: 8, marginTop: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: result.inhouse.would_call ? 'var(--success)' : 'var(--danger)' }}>
                {result.inhouse.would_call ? '✓ Would call for interview' : '✗ Would not call'}
              </div>
              <div style={{ fontSize: 13, marginTop: 4 }}>{result.inhouse.verdict}</div>
            </div>

            <Section title="First impression">
              <p className="text-sm">{result.inhouse.first_impression}</p>
            </Section>

            <Section title="Strengths">
              <BulletList items={result.inhouse.strengths} variant="success" />
            </Section>

            <Section title="Weaknesses">
              <BulletList items={result.inhouse.weaknesses} variant="danger" />
            </Section>

            <Section title="Improvements">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {result.inhouse.improvements.map((imp, i) => (
                  <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <span className={`badge ${priorityColor(imp.priority)}`} style={{ flexShrink: 0, marginTop: 1 }}>
                      {imp.priority}
                    </span>
                    <span className="text-sm">{imp.action}</span>
                  </div>
                ))}
              </div>
            </Section>
          </div>

          {/* ── GPT — Agency recruiter ── */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Building2 size={16} style={{ color: 'var(--success)' }} />
              <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--success)' }}>GPT-4o · Agency Recruiter</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, padding: 12, background: 'var(--surface-1)', borderRadius: 8 }}>
              <ATSRing score={result.agency.ats_score} />
              <div>
                <div style={{ fontWeight: 600 }}>ATS Score</div>
                <div className="text-sm text-muted">
                  {result.agency.ats_score >= 70 ? 'Likely to pass ATS filters' : result.agency.ats_score >= 50 ? 'May pass — improvements needed' : 'High risk of ATS rejection'}
                </div>
              </div>
            </div>

            <Section title="Marketability">
              <p className="text-sm">{result.agency.marketability}</p>
            </Section>

            <Section title="Keywords present">
              <div className="job-tags">
                {result.agency.keyword_hits.map(k => <span key={k} className="badge badge-success">{k}</span>)}
              </div>
            </Section>

            <Section title="Missing keywords">
              <div className="job-tags">
                {result.agency.keyword_gaps.map(k => <span key={k} className="badge badge-danger">{k}</span>)}
              </div>
            </Section>

            <Section title="ATS issues">
              <BulletList items={result.agency.ats_issues} variant="danger" />
            </Section>

            <Section title="Quick wins">
              <BulletList items={result.agency.quick_wins} variant="neutral" />
            </Section>
          </div>
        </div>
      )}

      {result && (
        <button className="btn btn-secondary btn-sm" style={{ marginTop: 20 }} onClick={() => { setResult(null); setError('') }}>
          Run again
        </button>
      )}
    </div>
  )
}
