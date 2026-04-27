import { Router } from 'express'
import twilio from 'twilio'
import { db, type Session } from '../db/client.js'

const router = Router()
const MIN_HOURS_BETWEEN_NUDGES = Number(process.env.NUDGE_COOLDOWN_HOURS || 24)

function hoursSince(date?: string | Date | null) {
  if (!date) return Infinity
  const t = typeof date === 'string' ? new Date(date).getTime() : date.getTime()
  if (!Number.isFinite(t)) return Infinity
  return (Date.now() - t) / 36e5
}

function chooseNudge(session: Session) {
  const rel = (session as any).relationship_memory || {}
  const silenceHours = hoursSince(session.lastActive as string | undefined)
  const lastNudgedHours = hoursSince((session as any).lastNudgedAt)

  if (lastNudgedHours < MIN_HOURS_BETWEEN_NUDGES) return null

  if (session.pending_action) {
    return `You left something half-open.\n\nWant to close it now?`
  }

  if (Array.isArray(rel.recurring_patterns) && rel.recurring_patterns.length && silenceHours > 18) {
    return `This is usually where things drift.\n\nPick one small move for today.`
  }

  if (Array.isArray(rel.friction_points) && rel.friction_points.length && silenceHours > 24) {
    return `You do not need a big reset.\n\nJust tell me what is stuck.`
  }

  if ((session.tasks_done || 0) > 0 && silenceHours > 36) {
    return `You had momentum.\n\nLet’s not let it go cold. What is the next small task?`
  }

  if (silenceHours > 48) {
    return `Quick check-in.\n\nWhat is the one thing you are avoiding?`
  }

  return null
}

async function sendWhatsApp(phone: string, body: string) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_FROM) {
    throw new Error('Twilio WhatsApp is not configured')
  }
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  await client.messages.create({
    from: process.env.TWILIO_WHATSAPP_FROM,
    to: `whatsapp:${phone}`,
    body
  })
}

router.post('/internal/nudges/run', async (req, res, next) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!process.env.NUDGE_SECRET || token !== process.env.NUDGE_SECRET) {
      return res.status(401).json({ error: 'unauthorized' })
    }

    const limit = Number(req.body?.limit || 50)
    const dryRun = Boolean(req.body?.dryRun)

    const { rows } = await db.query(`
      SELECT u.id, u.phone_e164, c.state_json, c.updated_at
      FROM users u
      JOIN conversations c ON c.user_id = u.id
      WHERE u.status = 'active'
        AND c.channel = 'whatsapp'
      ORDER BY c.updated_at ASC
      LIMIT $1
    `, [limit])

    const results: any[] = []

    for (const row of rows) {
      const session = (row.state_json || {}) as Session
      const nudge = chooseNudge(session)
      if (!nudge) {
        results.push({ user_id: row.id, sent: false, reason: 'no_nudge_needed' })
        continue
      }

      if (!dryRun) {
        await sendWhatsApp(row.phone_e164, nudge)
        session.messages = Array.isArray(session.messages) ? session.messages : []
        session.messages.push({ role: 'assistant', content: nudge })
        ;(session as any).lastNudgedAt = new Date().toISOString()
        await db.query(`
          UPDATE conversations
          SET state_json = $1, updated_at = now()
          WHERE user_id = $2 AND channel = 'whatsapp'
        `, [JSON.stringify(session), row.id])
      }

      results.push({ user_id: row.id, phone: row.phone_e164, sent: !dryRun, preview: nudge })
    }

    res.json({ ok: true, dryRun, checked: rows.length, results })
  } catch (err) { next(err) }
})

export default router
