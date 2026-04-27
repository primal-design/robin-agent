import { Router } from 'express'
import twilio from 'twilio'
import { db, type Session } from '../db/client.js'

const router = Router()
const MIN_HOURS_BETWEEN_NUDGES = Number(process.env.NUDGE_COOLDOWN_HOURS || 24)

type NudgeDecision = {
  body: string
  reason: string
  urgency: 'low' | 'medium' | 'high'
}

function hoursSince(date?: string | Date | null) {
  if (!date) return Infinity
  const t = typeof date === 'string' ? new Date(date).getTime() : date.getTime()
  if (!Number.isFinite(t)) return Infinity
  return (Date.now() - t) / 36e5
}

function hoursUntil(date?: string | Date | null) {
  if (!date) return Infinity
  const t = typeof date === 'string' ? new Date(date).getTime() : date.getTime()
  if (!Number.isFinite(t)) return Infinity
  return (t - Date.now()) / 36e5
}

function normaliseText(value: unknown) {
  return String(value || '').trim()
}

function extractDeadline(item: any): string | null {
  return item?.due_at || item?.dueAt || item?.deadline || item?.scheduled_for || item?.scheduledFor || null
}

function extractTitle(item: any) {
  return normaliseText(item?.title || item?.milestone || item?.task || item?.description || item?.goal || 'the next step')
}

function deadlineNudge(session: Session): NudgeDecision | null {
  const items = [
    ...(((session as any).commitments || []) as any[]),
    ...(((session as any).milestones || []) as any[]),
    ...(((session as any).pending_followups || []) as any[]),
  ].filter(Boolean)

  const open = items
    .map(item => ({ item, deadline: extractDeadline(item), title: extractTitle(item), hours: hoursUntil(extractDeadline(item)) }))
    .filter(x => x.deadline && Number.isFinite(x.hours))
    .sort((a, b) => a.hours - b.hours)

  const overdue = open.find(x => x.hours < 0)
  if (overdue) {
    return {
      urgency: 'high',
      reason: 'deadline_overdue',
      body: `${overdue.title} is overdue.\n\nNo drama. What is the smallest way to move it today?`
    }
  }

  const dueSoon = open.find(x => x.hours <= 24)
  if (dueSoon) {
    return {
      urgency: 'high',
      reason: 'deadline_due_soon',
      body: `${dueSoon.title} is due soon.\n\nDo you want to close it now or reduce the scope?`
    }
  }

  const upcoming = open.find(x => x.hours <= 72)
  if (upcoming) {
    return {
      urgency: 'medium',
      reason: 'deadline_upcoming',
      body: `${upcoming.title} is coming up.\n\nPick the next move before it becomes urgent.`
    }
  }

  return null
}

function goalNudge(session: Session): NudgeDecision | null {
  const facts = Array.isArray(session.facts) ? session.facts : []
  const goal = facts.find(f => /^Goal:/i.test(f))?.replace(/^Goal:\s*/i, '') || normaliseText((session as any).goal)
  const niche = facts.find(f => /^Niche:/i.test(f))?.replace(/^Niche:\s*/i, '') || normaliseText((session as any).niche)
  const silenceHours = hoursSince(session.lastActive as string | undefined)

  if (!goal || silenceHours < 30) return null

  if ((session.tasks_done || 0) === 0) {
    return {
      urgency: 'medium',
      reason: 'goal_no_first_action',
      body: `You set the goal: ${goal}.\n\nWe need the first visible action. What can you do in 10 minutes?`
    }
  }

  if (niche) {
    return {
      urgency: 'medium',
      reason: 'goal_path_nudge',
      body: `${goal} still needs reps.\n\nFor ${niche}, what is one person or business you can contact today?`
    }
  }

  return {
    urgency: 'low',
    reason: 'goal_generic_nudge',
    body: `${goal} is still the direction.\n\nWhat is the next small proof you can create?`
  }
}

function escalationLevel(session: Session) {
  const count = Number((session as any).nudgeCount || 0)
  if (count >= 3) return 'direct'
  if (count >= 1) return 'firm'
  return 'soft'
}

function applyEscalation(decision: NudgeDecision, session: Session): NudgeDecision {
  const level = escalationLevel(session)
  if (level === 'soft') return decision

  if (level === 'firm') {
    return {
      ...decision,
      body: `${decision.body}\n\nKeep it small. Reply with one word if needed.`
    }
  }

  return {
    ...decision,
    urgency: decision.urgency === 'low' ? 'medium' : decision.urgency,
    body: `This is the pattern.\n\n${decision.body}`
  }
}

function chooseNudge(session: Session): NudgeDecision | null {
  const rel = (session as any).relationship_memory || {}
  const silenceHours = hoursSince(session.lastActive as string | undefined)
  const lastNudgedHours = hoursSince((session as any).lastNudgedAt)

  if (lastNudgedHours < MIN_HOURS_BETWEEN_NUDGES) return null

  const deadline = deadlineNudge(session)
  if (deadline) return applyEscalation(deadline, session)

  if (session.pending_action) {
    return applyEscalation({ urgency: 'high', reason: 'pending_action', body: `You left something half-open.\n\nWant to close it now?` }, session)
  }

  const goal = goalNudge(session)
  if (goal) return applyEscalation(goal, session)

  if (Array.isArray(rel.recurring_patterns) && rel.recurring_patterns.length && silenceHours > 18) {
    return applyEscalation({ urgency: 'medium', reason: 'recurring_pattern', body: `This is usually where things drift.\n\nPick one small move for today.` }, session)
  }

  if (Array.isArray(rel.friction_points) && rel.friction_points.length && silenceHours > 24) {
    return applyEscalation({ urgency: 'medium', reason: 'friction_point', body: `You do not need a big reset.\n\nJust tell me what is stuck.` }, session)
  }

  if ((session.tasks_done || 0) > 0 && silenceHours > 36) {
    return applyEscalation({ urgency: 'low', reason: 'momentum_recovery', body: `You had momentum.\n\nLet’s not let it go cold. What is the next small task?` }, session)
  }

  if (silenceHours > 48) {
    return applyEscalation({ urgency: 'low', reason: 'long_silence', body: `Quick check-in.\n\nWhat is the one thing you are avoiding?` }, session)
  }

  return null
}

async function sendWhatsApp(phone: string, body: string) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_FROM) {
    throw new Error('Twilio WhatsApp is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM.')
  }

  if (!process.env.TWILIO_WHATSAPP_FROM.startsWith('whatsapp:')) {
    throw new Error('TWILIO_WHATSAPP_FROM must start with whatsapp:, for example whatsapp:+14155238886')
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
      const decision = chooseNudge(session)
      if (!decision) {
        results.push({ user_id: row.id, sent: false, reason: 'no_nudge_needed' })
        continue
      }

      if (!dryRun) {
        await sendWhatsApp(row.phone_e164, decision.body)
        session.messages = Array.isArray(session.messages) ? session.messages : []
        session.messages.push({ role: 'assistant', content: decision.body })
        ;(session as any).lastNudgedAt = new Date().toISOString()
        ;(session as any).nudgeCount = Number((session as any).nudgeCount || 0) + 1
        ;(session as any).lastNudgeReason = decision.reason
        await db.query(`
          UPDATE conversations
          SET state_json = $1, updated_at = now()
          WHERE user_id = $2 AND channel = 'whatsapp'
        `, [JSON.stringify(session), row.id])
      }

      results.push({ user_id: row.id, phone: row.phone_e164, sent: !dryRun, reason: decision.reason, urgency: decision.urgency, preview: decision.body })
    }

    res.json({ ok: true, dryRun, checked: rows.length, results })
  } catch (err) { next(err) }
})

export default router
