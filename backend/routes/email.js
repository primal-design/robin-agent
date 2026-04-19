/**
 * Email routes — Gmail OAuth + notifications
 * GET    /email/auth           — redirect to Gmail OAuth
 * GET    /email/callback       — OAuth callback
 * GET    /email/status         — check connection
 * DELETE /email/disconnect     — revoke access
 * GET    /email/notifications  — poll for new emails
 */

import { Router } from 'express'
import { optionalAuth } from '../middleware/authMiddleware.js'
import { getAuthUrl, exchangeCode } from '../lib/gmail.js'
import { saveGmailConnection, disconnectGmail, getGmailStatus } from '../models/emailAccount.js'

const router = Router()

// In-memory notification store (keyed by sessionId)
export const emailNotifications = new Map()

// GET /email/auth
router.get('/auth', (req, res) => {
  const sessionId = req.query.sessionId || 'web-default'
  const url = getAuthUrl() + `&state=${encodeURIComponent(sessionId)}`
  res.redirect(url)
})

// GET /email/callback
router.get('/callback', async (req, res, next) => {
  const { code, state: sessionId } = req.query
  if (!code) return res.status(400).send('No code')
  try {
    const tokens = await exchangeCode(code)
    const { email } = await saveGmailConnection(sessionId, tokens)

    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#fff">
      <div style="font-size:48px">🦊</div>
      <h2 style="color:#111">Gmail connected!</h2>
      <p style="color:#555">Robin can now read and manage your emails.</p>
      <p style="color:#B8976B;font-size:14px">${email}</p>
      <script>setTimeout(()=>window.close(),2000)</script>
    </body></html>`)
  } catch (err) { next(err) }
})

// GET /email/status
router.get('/status', optionalAuth, async (req, res, next) => {
  try {
    const status = await getGmailStatus(req.sessionId)
    res.json(status)
  } catch (err) { next(err) }
})

// DELETE /email/disconnect
router.delete('/disconnect', optionalAuth, async (req, res, next) => {
  try {
    await disconnectGmail(req.sessionId)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// GET /email/notifications
router.get('/notifications', optionalAuth, (req, res) => {
  const note = emailNotifications.get(req.sessionId)
  if (note) {
    emailNotifications.delete(req.sessionId)
    return res.json({ notification: note.message })
  }
  res.json({ notification: null })
})

export default router
