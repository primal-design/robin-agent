import './instrument.js'
import { assertRequired, env } from './config/env.js'
import { createApp } from './app.js'
import { ensureParaTables } from './memory/para.js'
import './queues/worker.js'
import { runDataRetention } from './jobs/dataRetention.js'
import { loadAndScheduleJobs } from './services/scheduler.js'

assertRequired()

ensureParaTables().catch(err => console.warn('PARA tables init failed:', err))
loadAndScheduleJobs().catch(err => console.warn('[scheduler] startup load failed:', err))

const app = createApp()

app.listen(env.port, () => {
  console.log(`🦊 FEN API running at http://localhost:${env.port}`)
})

// Run data retention daily at midnight
function scheduleMidnight(fn: () => void) {
  const now = new Date()
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  const ms = next.getTime() - now.getTime()
  setTimeout(() => { fn(); setInterval(fn, 24 * 60 * 60 * 1000) }, ms)
}
scheduleMidnight(() => runDataRetention().catch(err => console.error('[retention]', err)))
