import './instrument.js'
import { assertRequired, env } from './config/env.js'
import { createApp } from './app.js'
import { runDataRetention } from './jobs/dataRetention.js'
import { startDispatcher }         from './services/scheduler.js'
import { startEmbeddingWorker }    from './services/embeddingWorker.js'

assertRequired()

startDispatcher().catch(err => console.warn('[scheduler] dispatcher start failed:', err))
startEmbeddingWorker()

const app = createApp()

app.listen(env.port, () => {
  console.log(`🦊 FEN API running at http://localhost:${env.port}`)
})

function scheduleMidnight(fn: () => void) {
  const now  = new Date()
  const next = new Date(now)
  next.setDate(next.getDate() + 1)
  next.setHours(0, 0, 0, 0)
  const ms = next.getTime() - now.getTime()
  setTimeout(() => { fn(); setInterval(fn, 24 * 60 * 60 * 1000) }, ms)
}
scheduleMidnight(() => runDataRetention().catch(err => console.error('[retention]', err)))
