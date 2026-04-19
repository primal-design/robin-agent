/**
 * Pulse job — runs every 90s
 * Polls for new emails across active sessions
 */

import { pollNewEmails } from '../services/emailService.js'
import { logger } from '../lib/logger.js'

export function startPulseJob() {
  logger.info('Pulse job started (90s interval)')
  setInterval(async () => {
    try { await pollNewEmails() }
    catch (err) { logger.error('Pulse job error', err.message) }
  }, 90_000)
}
