/**
 * WhatsApp route — Twilio sandbox webhook
 * POST /whatsapp/incoming  — receives messages, replies via Robin brain
 */

import { Router } from 'express'
import twilio from 'twilio'
import { chatService } from '../services/chatService.js'

const router = Router()

// Twilio sends form-encoded bodies for WhatsApp webhooks
import express from 'express'
router.use(express.urlencoded({ extended: false }))

// POST /whatsapp/incoming
router.post('/whatsapp/incoming', async (req, res) => {
  try {
    const from    = req.body.From  // e.g. "whatsapp:+447700900000"
    const body    = req.body.Body?.trim()

    if (!from || !body) {
      res.set('Content-Type', 'text/xml')
      return res.send('<Response></Response>')
    }

    // Use the phone number as the session ID (strip "whatsapp:" prefix)
    const sessionId = from.replace('whatsapp:', '').replace(/\D/g, '')

    const reply = await chatService(sessionId, body)

    // Twilio expects TwiML
    const twiml = new twilio.twiml.MessagingResponse()
    twiml.message(reply)

    res.set('Content-Type', 'text/xml')
    res.send(twiml.toString())
  } catch (err) {
    console.error('[WhatsApp]', err.message)
    const twiml = new twilio.twiml.MessagingResponse()
    twiml.message("Robin's having a moment — try again in a sec 🦊")
    res.set('Content-Type', 'text/xml')
    res.send(twiml.toString())
  }
})

export default router
