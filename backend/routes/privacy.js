/**
 * Privacy routes — GDPR compliance
 * GET  /my-data/:sessionId  — export all user data
 * DELETE /delete-account    — full account deletion
 * DELETE /clear-memory      — wipe facts and messages only
 */

import { Router } from 'express'
import { optionalAuth } from '../middleware/authMiddleware.js'
import { exportData, resetMemory } from '../models/session.js'
import { deleteAccount } from '../lib/db.js'

const router = Router()

router.get('/my-data/:sessionId', async (req, res, next) => {
  try {
    const data = await exportData(req.params.sessionId)
    res.json(data)
  } catch (err) { next(err) }
})

router.delete('/delete-account', optionalAuth, async (req, res, next) => {
  try {
    await deleteAccount(req.sessionId)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

router.delete('/clear-memory', optionalAuth, async (req, res, next) => {
  try {
    await resetMemory(req.sessionId)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
