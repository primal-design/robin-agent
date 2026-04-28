// upgraded nudges with lifecycle integration
import { Router } from 'express'
import twilio from 'twilio'
import { db, type Session } from '../db/client.js'

const router = Router()

function getStage(session: Session) {
  const silence = (Date.now() - new Date(session.lastActive || Date.now()).getTime()) / 36e5
  if ((session.tasks_done || 0) === 0) return 'new'
  if (silence < 24) return 'active'
  if (silence < 48) return 'drifting'
  return 'at_risk'
}

function chooseChannel(user: any) {
  const lastWA = user.last_inbound_whatsapp_at ? new Date(user.last_inbound_whatsapp_at).getTime() : 0
  const hours = (Date.now() - lastWA) / 36e5
  return hours < 24 ? 'whatsapp' : 'email'
}

async function sendWhatsApp(phone: string, body: string) {
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: `whatsapp:${phone}`,
    body
  })
}

router.post('/internal/nudges/run', async (req, res) => {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (token !== process.env.NUDGE_SECRET) return res.status(401).json({ error: 'unauthorized' })

  const { rows } = await db.query(`
    SELECT u.*, c.state_json
    FROM users u
    JOIN conversations c ON c.user_id = u.id
    WHERE u.status='active'
    LIMIT 50
  `)

  const results: any[] = []

  for (const row of rows) {
    const session = (row.state_json || {}) as Session
    const stage = getStage(session)
    const channel = chooseChannel(row)

    let message = null

    if (stage === 'drifting') {
      message = 'You had momentum.\n\nWhat is the next step?'
    } else if (stage === 'at_risk') {
      message = 'You left this open.\n\nLet’s finish it.'
    }

    if (!message) continue

    if (channel === 'whatsapp') {
      await sendWhatsApp(row.phone_e164, message)
    }

    await db.query(`
      INSERT INTO lifecycle_events (user_id, stage, event_type, channel, payload_json)
      VALUES ($1,$2,$3,$4,$5)
    `, [row.id, stage, 'nudge_sent', channel, JSON.stringify({ message })])

    await db.query(`UPDATE users SET lifecycle_stage=$1, lifecycle_updated_at=now() WHERE id=$2`, [stage, row.id])

    results.push({ user: row.id, stage, channel, message })
  }

  res.json({ ok: true, results })
})

export default router
