/**
 * Actions routes
 * GET  /actions/:sessionId          — list pending actions
 * POST /actions/:actionId/approve   — approve or deny an action
 */

import { Router } from 'express'
import { optionalAuth } from '../middleware/authMiddleware.js'
import { getPendingActions, removeAction, findAction } from '../models/action.js'
import { getGmailTokens } from '../models/user.js'
import { sendEmail } from '../lib/gmail.js'

const router = Router()

// GET /actions/:sessionId
router.get('/:sessionId', async (req, res, next) => {
  try {
    const actions = await getPendingActions(req.params.sessionId)
    res.json({ actions, count: actions.length })
  } catch (err) { next(err) }
})

// POST /actions/:actionId/approve
router.post('/:actionId/approve', optionalAuth, async (req, res, next) => {
  try {
    const { approved } = req.body
    const sessionId    = req.sessionId
    const action       = await findAction(sessionId, req.params.actionId)
    if (!action) return res.status(404).json({ error: 'Action not found' })

    if (approved && action.type === 'draft_email') {
      const tokens = await getGmailTokens(sessionId)
      if (tokens) {
        await sendEmail(tokens, { to: action.to, subject: action.subject, body: action.body })
      }
    }

    await removeAction(sessionId, req.params.actionId)
    res.json({ ok: true, approved })
  } catch (err) { next(err) }
})

export default router
