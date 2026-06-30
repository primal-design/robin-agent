import { useEffect, useRef, useState } from 'react'
import { Sparkles, RefreshCw } from 'lucide-react'
import type { JobMatch } from '../lib/types'
import { api } from '../lib/api'
import { JobCard } from '../components/JobCard'

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

export function Matches() {
  const [matches, setMatches]   = useState<JobMatch[]>([])
  const [loading, setLoading]   = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg]   = useState('')
  const [elapsed, setElapsed]   = useState(0)
  const [error, setError]       = useState('')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = (quiet = false) => {
    if (!quiet) setLoading(true)
    return api.getMatches()
      .then(m => { setMatches(m); return m })
      .catch(e => { if (!e.message?.includes('404')) setError(e.message); return [] as JobMatch[] })
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

  if (loading) return <div className="text-muted" style={{ padding: 8 }}>Loading…</div>

  const mins = Math.floor(elapsed / 60)
  const secs = elapsed % 60
  const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16, flexWrap: 'wrap' }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1 className="page-title">Matches</h1>
          <p className="page-sub">{matches.length} job{matches.length !== 1 ? 's' : ''} matched to your profile. Start with the highest-fit roles and ignore the noise.</p>
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
      ) : (
        <div>
          <div className="section-header">
            <div className="section-title">Results</div>
          </div>
          {matches.map(m => <JobCard key={m.id} match={m} />)}
        </div>
      )}
    </div>
  )
}
