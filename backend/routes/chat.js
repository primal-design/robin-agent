/**
 * Chat routes
 * POST /chat   — main Robin conversation
 * POST /pulse  — autonomous trigger check / today's brief
 * POST /speak  — TTS (OpenAI or browser fallback)
 */

import { Router } from 'express'
import { optionalAuth } from '../middleware/authMiddleware.js'
import { chatLimit } from '../middleware/rateLimit.js'
import { loadSession, saveSession, loadProfile } from '../lib/db.js'
import { detectSignals, shouldTrigger, getTriggerRoute } from '../lib/signals.js'
import { buildUserContext, autonomousDecision, checkTriggers } from '../brain/brain.js'
import { chatService } from '../services/chatService.js'

const router = Router()

// POST /chat
router.post('/chat', optionalAuth, chatLimit, async (req, res, next) => {
  try {
    const { message, rejected } = req.body
    if (!message) return res.status(400).json({ error: 'No message' })

    const sessionId = req.sessionId
    const memory    = await loadSession(sessionId)
    if (rejected) memory.rejection_round = (memory.rejection_round || 0) + 1

    const isFirstReply = memory.messages.filter(m => m.role === 'assistant').length === 0

    // Signal detection
    memory.messages.push({ role: 'user', content: message })
    const signals  = detectSignals(memory.messages)
    const triggered = shouldTrigger(signals) && !memory.trigger_shown
    const route     = triggered ? getTriggerRoute(signals) : null
    if (triggered) memory.trigger_shown = true

    memory.messages.pop() // chatService will re-add
    const reply   = await chatService(sessionId, message)
    const updated = await loadSession(sessionId)

    res.json({
      type:           'response',
      reply,
      showProfilePrompt: isFirstReply,
      streak:         updated.streak || 0,
      total_earned:   updated.total_earned || 0,
      signals:        Object.keys(signals),
      trigger:        route,
      smartCallsLeft: Math.max(0, 10 - (updated.smart_calls_used || 0)),
    })
  } catch (err) { next(err) }
})

// POST /pulse — today's brief + autonomous trigger check
router.post('/pulse', optionalAuth, async (req, res, next) => {
  try {
    const memory  = await loadSession(req.sessionId)
    const profile = await loadProfile(req.sessionId)
    const ctx     = buildUserContext(memory, profile)
    const fired   = checkTriggers(ctx)

    if (fired.length > 0) {
      const trigger = fired[0]
      return res.json({
        triggered: true,
        trigger:   trigger.name,
        message:   trigger.message(ctx),
        stats: {
          pending:      (memory.pending_actions || []).length,
          handled:      memory.tasks_done || 0,
          total_earned: memory.total_earned || 0,
          streak:       memory.streak || 0,
        }
      })
    }

    const decision = await autonomousDecision(req.sessionId, memory, profile)
    if (decision.action !== 'NOTHING') {
      return res.json({
        triggered: true,
        trigger:   decision.action,
        message:   decision.message,
        stats: {
          pending:      (memory.pending_actions || []).length,
          handled:      memory.tasks_done || 0,
          total_earned: memory.total_earned || 0,
          streak:       memory.streak || 0,
        }
      })
    }

    res.json({
      triggered: false,
      stats: {
        pending:      (memory.pending_actions || []).length,
        handled:      memory.tasks_done || 0,
        total_earned: memory.total_earned || 0,
        streak:       memory.streak || 0,
      }
    })
  } catch (err) { next(err) }
})

// POST /speak — TTS
router.post('/speak', optionalAuth, async (req, res, next) => {
  try {
    const { text } = req.body
    if (!text) return res.status(400).json({ error: 'No text' })

    const clean = text.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').replace(/🦊/g, '').trim()

    if (process.env.OPENAI_KEY) {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method:  'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: 'tts-1', voice: 'onyx', input: clean, speed: 1.0 })
      })
      if (response.ok) {
        res.setHeader('Content-Type', 'audio/mpeg')
        return response.body.pipe(res)
      }
    }
    res.json({ fallback: true, text: clean })
  } catch (err) { next(err) }
})

export default router
