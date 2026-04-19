/**
 * Follow-up job — reminds users to chase their outreach
 * Checks pending_followups on sessions and surfaces reminders
 */

import { loadSession, saveSession } from '../lib/db.js'
import { logger } from '../lib/logger.js'

export function startFollowupJob() {
  setInterval(async () => {
    try {
      // TODO: scan all sessions for overdue pending_followups
      // For now checks web-default session only
      const session = await loadSession('web-default')
      const now     = Date.now()
      const due     = (session.pending_followups || []).filter(f => new Date(f.due_at).getTime() < now)
      if (due.length) {
        logger.info(`Follow-up job: ${due.length} overdue follow-ups for web-default`)
        // Mark as reminded so they don't fire repeatedly
        session.pending_followups = (session.pending_followups || []).map(f =>
          new Date(f.due_at).getTime() < now ? { ...f, reminded: true } : f
        )
        await saveSession('web-default', session)
      }
    } catch (err) { logger.error('Follow-up job error', err.message) }
  }, 30 * 60 * 1000) // every 30 mins

  logger.info('Follow-up job started (30m interval)')
}
