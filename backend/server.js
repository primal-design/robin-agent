/**
 * Robin server — entry point
 * dotenv must load before any other module reads process.env.
 * In ESM all static imports are hoisted, so we use a separate
 * loader file (load-env.js) that runs dotenv synchronously, then
 * dynamic-imports the rest of the app.
 */

// Load env first — this works because this file has no other top-level imports
import { config } from 'dotenv'
config()

const { default: app }           = await import('./app.js')
const { env }                    = await import('./config/env.js')
const { logger }                 = await import('./lib/logger.js')
const { startPulseJob }          = await import('./jobs/pulseJob.js')
const { startRetentionJob }      = await import('./jobs/retentionJob.js')
const { startFollowupJob }       = await import('./jobs/followupJob.js')

const PORT = env.PORT

app.listen(PORT, () => {
  logger.info(`🦊 Robin running at http://localhost:${PORT}`)
  startPulseJob()
  startRetentionJob()
  startFollowupJob()
})
