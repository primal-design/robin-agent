import { Router } from 'express'
import { chatService } from '../services/chat.service.js'

const router = Router()

router.post('/chat', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body
    if (!message) return res.status(400).json({ error: 'No message' })
    // sessionId is used as a phone/identifier to find-or-create a user
    const identifier = String(sessionId || req.ip || 'anonymous')
    const { findOrCreateUser } = await import('../db/client.js')
    const userId = await findOrCreateUser(identifier)
    const reply  = await chatService(userId, message)
    res.json({ type: 'response', reply })
  } catch (err) { next(err) }
})

export default router
