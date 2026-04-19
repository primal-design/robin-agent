/**
 * Robin server — entry point
 */

import 'dotenv/config'
import app from './app.js'
import { env } from './config/env.js'
import { logger } from './lib/logger.js'
import { startPulseJob }     from './jobs/pulseJob.js'
import { startRetentionJob } from './jobs/retentionJob.js'
import { startFollowupJob }  from './jobs/followupJob.js'

const PORT = env.PORT

app.listen(PORT, () => {
  logger.info(`🦊 Robin running at http://localhost:${PORT}`)
  startPulseJob()
  startRetentionJob()
  startFollowupJob()
})
