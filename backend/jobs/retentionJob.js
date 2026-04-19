/**
 * Retention job — daily streak warnings
 * Identifies users at risk of losing their streak
 * (Placeholder — extend with Redis scan when multi-session support lands)
 */

import { logger } from '../lib/logger.js'

export function startRetentionJob() {
  // Run once per hour
  setInterval(async () => {
    try {
      // TODO: scan all sessions from Redis and send streak warnings
      // for now this is a no-op placeholder
    } catch (err) { logger.error('Retention job error', err.message) }
  }, 60 * 60 * 1000)

  logger.info('Retention job started (1h interval)')
}
