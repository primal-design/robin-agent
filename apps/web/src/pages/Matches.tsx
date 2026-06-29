import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import type { JobMatch } from '../lib/types'
import { api } from '../lib/api'
import { JobCard } from '../components/JobCard'

export function Matches() {
  const [matches, setMatches] = useState<JobMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => {
    api.getMatches()
      .then(setMatches)
      .catch(e => { if (!e.message?.includes('404')) setError(e.message) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="text-muted" style={{ padding: 8 }}>Loading…</div>
  if (error)   return <div className="banner banner-danger">{error}</div>

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Matches</h1>
        <p className="page-sub">{matches.length} job{matches.length !== 1 ? 's' : ''} matched to your profile</p>
      </div>

      {matches.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon"><Sparkles size={32} strokeWidth={1.5} /></div>
          <h3>No matches yet</h3>
          <p>FEN will find jobs when it next scans. Check back soon.</p>
        </div>
      ) : (
        matches.map(m => <JobCard key={m.id} match={m} />)
      )}
    </div>
  )
}
