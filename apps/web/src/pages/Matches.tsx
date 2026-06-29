import { useEffect, useState } from 'react'
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
  const [matches, setMatches] = useState<JobMatch[]>([])
  const [loading, setLoading]   = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg]   = useState('')
  const [error, setError]       = useState('')

  const load = () => {
    setLoading(true)
    api.getMatches()
      .then(setMatches)
      .catch(e => { if (!e.message?.includes('404')) setError(e.message) })
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  const runScan = async () => {
    setScanning(true)
    setScanMsg('')
    setError('')
    try {
      await triggerScan()
      setScanMsg('Scan complete — refreshing matches…')
      setTimeout(() => { setScanMsg(''); load() }, 1500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }

  if (loading) return <div className="text-muted" style={{ padding: 8 }}>Loading…</div>

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16, flexWrap: 'wrap' }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1 className="page-title">Matches</h1>
          <p className="page-sub">{matches.length} job{matches.length !== 1 ? 's' : ''} matched to your profile</p>
        </div>
        <button className="btn btn-secondary" onClick={runScan} disabled={scanning} style={{ flexShrink: 0 }}>
          <RefreshCw size={14} className={scanning ? 'spin' : ''} />
          {scanning ? 'Scanning…' : 'Run scan now'}
        </button>
      </div>

      {error   && <div className="banner banner-danger" style={{ marginBottom: 16 }}>{error}</div>}
      {scanMsg && <div className="banner banner-success" style={{ marginBottom: 16 }}>{scanMsg}</div>}

      {matches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Sparkles size={32} strokeWidth={1.5} /></div>
          <h3>No matches yet</h3>
          <p>Hit "Run scan now" to fetch jobs and match them to your profile.</p>
        </div>
      ) : (
        matches.map(m => <JobCard key={m.id} match={m} />)
      )}
    </div>
  )
}
