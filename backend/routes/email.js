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

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function resolveSessionId(query = {}) {
  const sessionId = String(query.sessionId || '').trim()
  if (sessionId) return sessionId

  const phone = String(query.phone || '').replace(/\D/g, '')
  if (phone) return `sid_${phone}`

  return 'web-default'
}

function stringifyErrorDetail(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.message || value.name || 'Unknown error'

  if (typeof value === 'object') {
    const fields = [
      value.error_description,
      value.description,
      value.message,
      value.detail,
      value.hint,
      value.code,
      typeof value.error === 'string' ? value.error : '',
      typeof value.error === 'object' && value.error ? value.error.error_description : '',
      typeof value.error === 'object' && value.error ? value.error.message : '',
      typeof value.error === 'object' && value.error ? value.error.status : '',
    ]

    const match = fields.find(item => typeof item === 'string' && item.trim())
    if (match) return match

    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return Object.prototype.toString.call(value)
    }
  }

  return String(value)
}

function gmailErrorMessage(err) {
  const full = stringifyErrorDetail(err?.response?.data || err?.message || err || 'Unknown error')

  if (full.includes('invalid_client')) {
    return 'Google rejected the client credentials. Check GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Render.'
  }
  if (full.includes('redirect_uri_mismatch')) {
    return 'The Google redirect URI does not match. Both Render and Google Console should use https://robin-agent.onrender.com/email/callback.'
  }
  if (full.includes('invalid_grant')) {
    return 'This Google sign-in code is expired or already used. Start the Gmail connect flow again from the dashboard.'
  }

  return full
}

// GET /email/auth
router.get('/auth', (req, res) => {
  const sessionId = resolveSessionId(req.query)
  const url = getAuthUrl() + `&state=${encodeURIComponent(sessionId)}`
  res.redirect(url)
})

// GET /email/connect
router.get('/connect', (req, res) => {
  const sessionId = resolveSessionId(req.query)
  const url = getAuthUrl() + `&state=${encodeURIComponent(sessionId)}`
  res.redirect(url)
})

// GET /email/callback
router.get('/callback', async (req, res) => {
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
  } catch (err) {
    const message = gmailErrorMessage(err)
    console.error('[Gmail callback]', message, err)
    res.status(500).send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#fff">
      <div style="font-size:48px">🦊</div>
      <h2 style="color:#111">Gmail connection failed</h2>
      <p style="color:#555;max-width:560px;margin:0 auto 16px">Robin received the Google callback, but the final connection step failed.</p>
      <code style="display:block;max-width:560px;margin:0 auto;padding:12px;background:#f5f1ea;color:#6b5336;white-space:pre-wrap">${escapeHtml(message)}</code>
      <p style="margin-top:20px"><a href="/frontend/robin_dashboard.html" style="color:#B8976B">Return to dashboard</a></p>
    </body></html>`)
  }
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
