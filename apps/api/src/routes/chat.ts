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

router.post('/signup', async (req, res, next) => {
  try {
    const { name, phone, role, cracks, note } = req.body
    if (!name || !phone) return res.status(400).json({ error: 'Name and phone required' })

    const { findOrCreateUser, db } = await import('../db/client.js')
    const userId = await findOrCreateUser(phone)

    await db.query(`UPDATE users SET name=$1 WHERE id=$2`, [name, userId])

    // Return existing request if phone already on waitlist
    const existing = await db.query(
      `SELECT request_id, submitted_at FROM waitlist WHERE phone=$1 LIMIT 1`,
      [phone]
    )

    let requestId: string
    let submitted: string
    let isNew = false

    if (existing.rows.length > 0) {
      requestId = existing.rows[0].request_id
      submitted = new Date(existing.rows[0].submitted_at).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })
    } else {
      requestId = 'R-' + Date.now().toString(36).toUpperCase().slice(-6)
      submitted = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })
      isNew = true
      await db.query(
        `INSERT INTO waitlist (request_id, name, phone, role, cracks, note)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [requestId, name, phone, role||null, cracks||null, note||null]
      )
    }

    // Send WhatsApp confirmation only for new signups
    if (!isNew) return res.json({ request_id: requestId, submitted, name })

    try {
      const twilio = (await import('twilio')).default
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to:   `whatsapp:${phone}`,
        body: `Hi ${name} 👋 I'm Robin.\n\nYour access request has been received.\n\nRequest ID: ${requestId}\n\nI'll be in touch once your request is reviewed. Sit tight.`
      })
    } catch (e) {
      console.warn('[signup] WhatsApp notify failed:', (e as Error).message)
    }

    res.json({ request_id: requestId, submitted, name })
  } catch (err) { next(err) }
})

export default router
