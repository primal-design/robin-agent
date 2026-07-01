import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Briefcase, RefreshCw, Sparkles } from 'lucide-react'
import type { JobMatch, MatchFeedback } from '../lib/types'
import { api } from '../lib/api'

async function triggerScan(): Promise<void> {
  const token = localStorage.getItem('fen_token')
  const res = await fetch('/matches/run', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
}

function formatSalary(match: JobMatch) {
  const { salary_min: min, salary_max: max, salary_currency: currency = 'GBP' } = match.job
  if (!min) return 'Not listed'
  const fmt = (value: number) => new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
  return max ? `${fmt(min)} – ${fmt(max)}` : fmt(min)
}

function feedbackLabel(value?: MatchFeedback) {
  if (value === 'interested') return 'Saved to applications'
  if (value === 'skip') return 'Skipped'
  if (value === 'not_relevant') return 'Hidden from your shortlist'
  return null
}

export function Matches() {
  const [matches, setMatches]   = useState<JobMatch[]>([])
  const [loading, setLoading]   = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg]   = useState('')
  const [elapsed, setElapsed]   = useState(0)
  const [error, setError]       = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feedbackState, setFeedbackState] = useState<Record<string, MatchFeedback>>({})
  const [savingFeedback, setSavingFeedback] = useState<MatchFeedback | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = (quiet = false) => {
    if (!quiet) setLoading(true)
    return api.getMatches()
      .then(m => {
        setMatches(m)
        setFeedbackState(current => {
          const next = { ...current }
          for (const match of m) {
            if (match.user_feedback) next[match.id] = match.user_feedback
          }
          return next
        })
        return m
      })
      .catch(e => {
        if (e.message?.includes('profile_not_found')) {
          setError('Upload a CV first to start matching jobs.')
        } else if (!e.message?.includes('404')) {
          setError(e.message)
        }
        return [] as JobMatch[]
      })
      .finally(() => { if (!quiet) setLoading(false) })
  }

  useEffect(() => { load() }, [])

  const stopPoll = () => {
    if (pollRef.current)  { clearInterval(pollRef.current);  pollRef.current  = null }
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }

  const runScan = async () => {
    setScanning(true)
    setScanMsg('')
    setError('')
    setElapsed(0)
    try {
      await triggerScan()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
      setScanning(false)
      return
    }

    // Tick elapsed time
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000)

    // Poll every 15s for up to 3 minutes
    let attempts = 0
    const maxAttempts = 12
    pollRef.current = setInterval(async () => {
      attempts++
      const found = await load(true)
      if (found.length > 0 || attempts >= maxAttempts) {
        stopPoll()
        setScanning(false)
        setScanMsg(found.length > 0 ? `Found ${found.length} match${found.length !== 1 ? 'es' : ''}!` : 'Scan complete — no matches yet. Try again later.')
        setTimeout(() => setScanMsg(''), 4000)
      }
    }, 15000)
  }

  // Cleanup on unmount
  useEffect(() => () => stopPoll(), [])

  const visibleMatches = useMemo(
    () => matches.filter(match => {
      const feedback = feedbackState[match.id]
      return feedback !== 'skip' && feedback !== 'not_relevant'
    }),
    [feedbackState, matches],
  )

  useEffect(() => {
    if (!visibleMatches.length) {
      setSelectedId(null)
      return
    }
    if (!selectedId || !visibleMatches.some(match => match.id === selectedId)) {
      setSelectedId(visibleMatches[0].id)
    }
  }, [selectedId, visibleMatches])

  const selected = visibleMatches.find(match => match.id === selectedId) ?? visibleMatches[0] ?? null

  const saveFeedback = async (feedback: MatchFeedback) => {
    if (!selected) return
    setSavingFeedback(feedback)
    setError('')
    try {
      await api.setMatchFeedback(selected.id, feedback)
      setFeedbackState(current => ({ ...current, [selected.id]: feedback }))
      const label = feedback === 'interested'
        ? 'Saved to applications.'
        : feedback === 'skip'
          ? 'Match skipped for now.'
          : 'Match removed from your shortlist.'
      setScanMsg(label)
      setTimeout(() => setScanMsg(''), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update this match')
    } finally {
      setSavingFeedback(null)
    }
  }

  if (loading) return <div className="text-muted" style={{ padding: 8 }}>Loading…</div>

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16, flexWrap: 'wrap' }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1 className="page-title">Matches</h1>
          <p className="page-sub">
            {visibleMatches.length} job{visibleMatches.length !== 1 ? 's' : ''} ready to review.
            {matches.length !== visibleMatches.length ? ` ${matches.length - visibleMatches.length} hidden from this list.` : ''}
          </p>
        </div>
        <button className="btn btn-secondary" onClick={runScan} disabled={scanning} style={{ flexShrink: 0 }}>
          <RefreshCw size={14} style={scanning ? { animation: 'spin .8s linear infinite' } : {}} />
          {scanning ? `Scanning… ${elapsedStr}` : 'Run scan now'}
        </button>
      </div>

      {error   && <div className="banner banner-danger"  style={{ marginBottom: 16 }}>{error}</div>}
      {scanMsg && <div className="banner banner-success" style={{ marginBottom: 16 }}>{scanMsg}</div>}

      {scanning && (
        <div className="banner banner-info" style={{ marginBottom: 16 }}>
          Fetching jobs from Reed, LinkedIn, Indeed and more — this takes 2–3 minutes. Results will appear automatically.
        </div>
      )}

      {matches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Sparkles size={32} strokeWidth={1.5} /></div>
          <h3>No matches yet</h3>
          <p>Hit "Run scan now" to fetch jobs and match them to your profile.</p>
        </div>
      ) : visibleMatches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Sparkles size={32} strokeWidth={1.5} /></div>
          <h3>Your shortlist is empty</h3>
          <p>Run another scan or upload a stronger CV to repopulate this list.</p>
        </div>
      ) : (
        <div className="matches-shell">
          <aside className="match-list">
            <div className="match-list-header">
              <div>
                <div className="section-title" style={{ marginBottom: 6 }}>Results</div>
                <div className="match-list-title">{visibleMatches.length} active matches</div>
              </div>
              <div className="score-chip">{visibleMatches[0]?.score ?? 0}+</div>
            </div>

            {visibleMatches.map(match => {
              const salary = formatSalary(match)
              return (
                <button
                  key={match.id}
                  type="button"
                  className={`jcard${selected?.id === match.id ? ' sel' : ''}`}
                  onClick={() => setSelectedId(match.id)}
                >
                  <div className="jcard-top">
                    <div>
                      <div className="jcard-title">{match.job.title}</div>
                      <div className="jcard-co">{match.job.company}</div>
                    </div>
                    <div className="score-chip">{match.score}</div>
                  </div>

                  <div className="jcard-pills">
                    {match.job.location && <span className="jpill">{match.job.location}</span>}
                    {salary !== 'Not listed' && <span className="jpill">{salary}</span>}
                  </div>

                  {match.recommendation && (
                    <div className="jcard-reasons">
                      {match.recommendation.length > 108
                        ? `${match.recommendation.slice(0, 108).trimEnd()}…`
                        : match.recommendation}
                    </div>
                  )}
                </button>
              )
            })}
          </aside>

          <section className="detail-panel">
            {selected ? (
              <>
                <div className="detail-head">
                  <div className="section-title" style={{ marginBottom: 8 }}>Selected match</div>
                  <h2 className="dp-title">{selected.job.title}</h2>
                  <div className="dp-co">{selected.job.company}</div>
                </div>

                <div className="score-row">
                  <div className="score-chip score-chip-lg">{selected.score}</div>
                  <div>
                    <div className="score-label">Current fit score</div>
                    <div className="score-sub">
                      {selected.score >= 70
                        ? 'Strong fit based on your current profile.'
                        : selected.score >= 50
                          ? 'Reasonable fit, but still needs review.'
                          : 'Weak fit. Check the gaps before spending time here.'}
                    </div>
                  </div>
                </div>

                {feedbackLabel(feedbackState[selected.id]) && (
                  <div className="banner banner-success mb-4">{feedbackLabel(feedbackState[selected.id])}</div>
                )}

                <div className="dp-grid">
                  <div className="dp-meta">
                    <div className="dp-meta-key">Location</div>
                    <div className="dp-meta-val">{selected.job.location || 'Not listed'}</div>
                  </div>
                  <div className="dp-meta">
                    <div className="dp-meta-key">Salary</div>
                    <div className="dp-meta-val">{formatSalary(selected)}</div>
                  </div>
                  <div className="dp-meta">
                    <div className="dp-meta-key">Source</div>
                    <div className="dp-meta-val">{selected.job.source || 'Imported match'}</div>
                  </div>
                  <div className="dp-meta">
                    <div className="dp-meta-key">Status</div>
                    <div className="dp-meta-val">{feedbackLabel(feedbackState[selected.id]) || 'Awaiting decision'}</div>
                  </div>
                </div>

                {selected.recommendation && (
                  <>
                    <div className="dp-section">Why this showed up</div>
                    <div className="dp-rec">{selected.recommendation}</div>
                  </>
                )}

                {selected.skill_matches.length > 0 && (
                  <>
                    <div className="dp-section">Strength matches</div>
                    <div className="job-tags">
                      {selected.skill_matches.map(skill => (
                        <span key={skill} className="badge badge-success">{skill}</span>
                      ))}
                    </div>
                  </>
                )}

                {selected.skill_gaps.length > 0 && (
                  <>
                    <div className="dp-section">Likely gaps</div>
                    <div className="job-tags">
                      {selected.skill_gaps.map(skill => (
                        <span key={skill} className="badge badge-danger">{skill}</span>
                      ))}
                    </div>
                  </>
                )}

                {selected.job.description && (
                  <>
                    <div className="dp-section">Job description</div>
                    <div className="detail-copy">
                      {selected.job.description.split(/\n{2,}/).slice(0, 4).map((paragraph, index) => (
                        <p key={index}>{paragraph.trim()}</p>
                      ))}
                    </div>
                  </>
                )}

                <div className="dp-section">Next action</div>
                <div className="dp-actions">
                  {selected.job.url && selected.job.url !== '#' && (
                    <a href={selected.job.url} target="_blank" rel="noreferrer" className="btn btn-primary">
                      <ArrowUpRight size={15} strokeWidth={2} />
                      Open listing
                    </a>
                  )}
                  <button
                    className="btn btn-secondary"
                    disabled={savingFeedback !== null || feedbackState[selected.id] === 'interested'}
                    onClick={() => saveFeedback('interested')}
                  >
                    <Briefcase size={15} strokeWidth={2} />
                    {feedbackState[selected.id] === 'interested' ? 'Saved to applications' : savingFeedback === 'interested' ? 'Saving…' : 'Save to applications'}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={savingFeedback !== null}
                    onClick={() => saveFeedback('not_relevant')}
                  >
                    {savingFeedback === 'not_relevant' ? 'Updating…' : 'Hide this match'}
                  </button>
                </div>
              </>
            ) : (
              <div className="detail-empty">
                <Sparkles size={30} strokeWidth={1.5} />
                <div className="detail-empty-text">Select a match to review the details.</div>
                <div className="detail-empty-sub">Your strongest roles stay in the list on the left.</div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
