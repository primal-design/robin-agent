import './instrument.js'
import { assertRequired, env } from './config/env.js'
import { createApp } from './app.js'
import { ensureParaTables } from './memory/para.js'
import './queues/worker.js'

assertRequired()

ensureParaTables().catch(err => console.warn('PARA tables init failed:', err))

const app = createApp()

app.listen(env.port, () => {
  console.log(`🦊 FEN API running at http://localhost:${env.port}`)
})
