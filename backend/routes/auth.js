/**
 * Auth routes
 * POST /signup        — request access / create account
 * GET  /profile       — get user profile
 * GET  /my-data/:sid  — GDPR export
 * POST /clear-memory  — wipe facts + messages
 * POST /delete-account — full deletion
 */

import { Router } from 'express'
import { createUser, getUser } from '../models/user.js'
import { exportData, resetMemory } from '../models/session.js'
import { deleteAccount } from '../lib/db.js'
import { optionalAuth } from '../middleware/authMiddleware.js'
import { generateSessionId } from '../lib/crypto.js'

const router = Router()

// POST /signup
router.post('/signup', optionalAuth, async (req, res, next) => {
  try {
    const { name, email, phone, role, cracks, note, gdpr_consent, sessionId } = req.body
    if (!gdpr_consent) return res.status(400).json({ error: 'Consent required' })

    const sid  = sessionId || req.sessionId || generateSessionId()
    const user = await createUser(sid, { name, email, phone, role, cracks, note, gdpr_consent })

    const reqId = `R-${Date.now().toString(36).toUpperCase().slice(-6)}-${Math.random().toString(36).slice(2,4).toUpperCase()}`

    res.json({
      ok:         true,
      name,
      sessionId:  sid,
      token:      sid,           // frontend stores as robin_token
      request_id: reqId,
      submitted:  new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
    })
  } catch (err) { next(err) }
})

// GET /profile
router.get('/profile', optionalAuth, async (req, res, next) => {
  try {
    const user = await getUser(req.sessionId)
    if (!user) return res.status(404).json({ error: 'No profile found' })
    res.json({
      name:         user.name || null,
      email:        user.email || null,
      phone:        user.phone || null,
      role:         user.role || null,
      consented_at: user.consented_at,
      gmail_email:  user.gmail_email || null,
    })
  } catch (err) { next(err) }
})

// GET /my-data/:sessionId
router.get('/my-data/:sessionId', async (req, res, next) => {
  try {
    const data = await exportData(req.params.sessionId)
    res.json(data)
  } catch (err) { next(err) }
})

// POST /clear-memory
router.delete('/clear-memory', optionalAuth, async (req, res, next) => {
  try {
    await resetMemory(req.sessionId)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// DELETE /delete-account
router.delete('/delete-account', optionalAuth, async (req, res, next) => {
  try {
    await deleteAccount(req.sessionId)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
