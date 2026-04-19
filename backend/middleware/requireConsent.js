/**
 * Consent middleware — ensures user has agreed to data processing
 */

import { loadUser } from '../lib/db.js'

export async function requireConsent(req, res, next) {
  const sessionId = req.sessionId || 'web-default'
  try {
    const user = await loadUser(sessionId)
    if (!user?.gdpr_consent) {
      return res.status(403).json({ error: 'Consent required', code: 'NO_CONSENT' })
    }
    next()
  } catch (err) {
    next(err)
  }
}
