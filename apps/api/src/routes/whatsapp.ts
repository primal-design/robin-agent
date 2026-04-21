import { Router } from 'express'
import twilio from 'twilio'
import { chatService } from '../services/chat.service.js'
import { findOrCreateUser } from '../db/client.js'

const router = Router()

router.post('/incoming', async (req, res) => {
  try {
    const from = String(req.body.From || '')
    const body = String(req.body.Body || '').trim()

    if (!from || !body) {
      res.set('Content-Type', 'text/xml')
      return res.send('<Response></Response>')
    }

    const phoneE164 = from.replace('whatsapp:', '')
    const userId    = await findOrCreateUser(phoneE164)
    const reply     = await chatService(userId, body)

    const twiml = new twilio.twiml.MessagingResponse()
    twiml.message(reply)
    res.set('Content-Type', 'text/xml').send(twiml.toString())
  } catch (err) {
    console.error('[WhatsApp]', err)
    const twiml = new twilio.twiml.MessagingResponse()
    twiml.message("Robin's having a moment — try again in a sec 🦊")
    res.set('Content-Type', 'text/xml').send(twiml.toString())
  }
})

export default router
