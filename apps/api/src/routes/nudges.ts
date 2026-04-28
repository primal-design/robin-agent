import { Router } from 'express'
import twilio from 'twilio'
import { db, type Session } from '../db/client.js'

const router = Router()
const MIN_HOURS_BETWEEN_NUDGES = Number(process.env.NUDGE_COOLDOWN_HOURS || 24)

type Stage = 'new' | 'engaged' | 'active' | 'drifting' | 'at_risk' | 're_engaged'
type Channel = 'email' | 'whatsapp' | 'none'
type Urgency = 'low' | 'medium' | 'high'
type Decision = { body: string; subject?: string; reason: string; urgency: Urgency; score: number }

function toDate(value: unknown) {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isFinite(date.getTime()) ? date : null
}

function hoursSince(value: unknown) {
  const date = toDate(value)
  if (!date) return Infinity
  return (Date.now() - date.getTime()) / 36e5
}

function hoursUntil(value: unknown) {
  const date = toDate(value)
  if (!date) return Infinity
  return (date.getTime() - Date.now()) / 36e5
}

function text(value: unknown) {
  return String(value || '').trim()
}

function getGoal(session: Session) {
  const facts = Array.isArray(session.facts) ? session.facts : []
  return facts.find(f => /^Goal:/i.test(f))?.replace(/^Goal:\s*/i, '') || text((session as any).goal)
}

function getNiche(session: Session) {
  const facts = Array.isArray(session.facts) ? session.facts : []
  return facts.find(f => /^Niche:/i.test(f))?.replace(/^Niche:\s*/i, '') || text((session as any).niche)
}

function extractTitle(item: any) {
  return text(item?.title || item?.milestone || item?.task || item?.description || item?.goal || 'the next step')
}

function extractDeadline(item: any) {
  return item?.due_at || item?.dueAt || item?.deadline || item?.scheduled_for || item?.scheduledFor || null
}

function lifecycleStage(session: Session): Stage {
  const silence = hoursSince(session.lastActive)
  const tasks = Number(session.tasks_done || 0)
  const assistantCount = Array.isArray(session.messages) ? session.messages.filter((m: any) => m.role === 'assistant').length : 0
  const nudgeCount = Number((session as any).nudgeCount || 0)

  if (tasks === 0 && assistantCount <= 2) return 'new'
  if (tasks === 0 && assistantCount > 2) return 'engaged'
  if (silence <= 24) return 'active'
  if (silence <= 72) return 'drifting'
  if (nudgeCount > 0 && silence <= 24) return 're_engaged'
  return 'at_risk'
}

function escalation(session: Session) {
  const count = Number((session as any).nudgeCount || 0)
  if (count >= 3) return 'direct'
  if (count >= 1) return 'firm'
  return 'soft'
}

function applyEscalation(decision: Decision, session: Session): Decision {
  const level = escalation(session)
  if (level === 'soft') return decision
  if (level === 'firm') return { ...decision, body: `${decision.body}\n\nKeep it small. Reply with one word if needed.` }
  return { ...decision, urgency: decision.urgency === 'low' ? 'medium' : decision.urgency, body: `This is the pattern.\n\n${decision.body}` }
}

function deadlineDecision(session: Session): Decision | null {
  const items = [
    ...(((session as any).commitments || []) as any[]),
    ...(((session as any).milestones || []) as any[]),
    ...(((session as any).pending_followups || []) as any[]),
  ].filter(Boolean)

  const open = items
    .map(item => ({ title: extractTitle(item), deadline: extractDeadline(item), hours: hoursUntil(extractDeadline(item)) }))
    .filter(x => x.deadline && Number.isFinite(x.hours))
    .sort((a, b) => a.hours - b.hours)

  const overdue = open.find(x => x.hours < 0)
  if (overdue) return { urgency: 'high', score: 95, reason: 'deadline_overdue', subject: 'This slipped', body: `${overdue.title} is overdue.\n\nNo drama. What is the smallest way to move it today?` }

  const dueSoon = open.find(x => x.hours <= 24)
  if (dueSoon) return { urgency: 'high', score: 90, reason: 'deadline_due_soon', subject: 'This is due', body: `${dueSoon.title} is due soon.\n\nDo you close it now — or reduce the scope?` }

  const upcoming = open.find(x => x.hours <= 72)
  if (upcoming) return { urgency: 'medium', score: 70, reason: 'deadline_upcoming', subject: 'Coming up', body: `${upcoming.title} is coming up.\n\nPick the next move before it becomes urgent.` }

  return null
}

function goalDecision(session: Session): Decision | null {
  const goal = getGoal(session)
  const niche = getNiche(session)
  const silence = hoursSince(session.lastActive)
  if (!goal || silence < 24) return null

  if (Number(session.tasks_done || 0) === 0) return { urgency: 'medium', score: 75, reason: 'goal_no_first_action', subject: 'First move', body: `You set the goal: ${goal}.\n\nWe need the first visible action. What can you do in 10 minutes?` }

  if (niche) return { urgency: 'medium', score: 65, reason: 'goal_path_nudge', subject: 'Keep moving', body: `${goal} still needs reps.\n\nFor ${niche}, who can you contact today?` }

  return { urgency: 'low', score: 45, reason: 'goal_generic_nudge', subject: 'Next proof', body: `${goal} is still the direction.\n\nWhat is the next small proof you can create?` }
}

function relationshipDecision(session: Session): Decision | null {
  const rel = (session as any).relationship_memory || {}
  const silence = hoursSince(session.lastActive)

  if (session.pending_action) return { urgency: 'high', score: 85, reason: 'pending_action', subject: 'Left open', body: `You left something half-open.\n\nWant to close it now?` }

  if (Array.isArray(rel.recurring_patterns) && rel.recurring_patterns.length && silence > 18) return { urgency: 'medium', score: 60, reason: 'recurring_pattern', subject: 'This is where it drifts', body: `This is usually where things drift.\n\nPick one small move for today.` }

  if (Array.isArray(rel.friction_points) && rel.friction_points.length && silence > 24) return { urgency: 'medium', score: 58, reason: 'friction_point', subject: 'Quick check', body: `You do not need a big reset.\n\nJust tell me what is stuck.` }

  return null
}

function stageDecision(stage: Stage, session: Session): Decision | null {
  const silence = hoursSince(session.lastActive)
  if (stage === 'new' && silence > 18) return { urgency: 'low', score: 35, reason: 'new_user_activation', subject: 'Start simple', body: `Start simple.\n\nWhat is one thing slowing you down?` }
  if (stage === 'drifting') return { urgency: 'medium', score: 55, reason: 'momentum_recovery', subject: 'Don’t lose this', body: `You had momentum.\n\nLet’s not let it go cold. What is the next step?` }
  if (stage === 'at_risk') return { urgency: 'medium', score: 70, reason: 'reactivation', subject: 'Let’s reset', body: `No big reset needed.\n\nWhat is one step today?` }
  return null
}

function chooseDecision(session: Session, stage: Stage): Decision | null {
  const lastNudged = hoursSince((session as any).lastNudgedAt)
  if (lastNudged < MIN_HOURS_BETWEEN_NUDGES) return null

  const candidates = [deadlineDecision(session), relationshipDecision(session), goalDecision(session), stageDecision(stage, session)].filter(Boolean) as Decision[]
  if (!candidates.length) return null
  const decision = candidates.sort((a, b) => b.score - a.score)[0]
  return applyEscalation(decision, session)
}

function chooseChannel(user: any): Channel {
  const email = text(user.email)
  const whatsappHours = hoursSince(user.last_inbound_whatsapp_at)
  if (whatsappHours <= 24) return 'whatsapp'
  if (email) return 'email'
  return 'none'
}

async function sendWhatsApp(phone: string, body: string) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_FROM) throw new Error('Twilio WhatsApp is not configured')
  if (!process.env.TWILIO_WHATSAPP_FROM.startsWith('whatsapp:')) throw new Error('TWILIO_WHATSAPP_FROM must start with whatsapp:')
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  await client.messages.create({ from: process.env.TWILIO_WHATSAPP_FROM, to: `whatsapp:${phone}`, body })
}

async function sendEmail(email: string, subject: string, body: string) {
  if (!process.env.RESEND_API_KEY) throw new Error('Email nudges need RESEND_API_KEY')
  const appUrl = process.env.PUBLIC_APP_URL || 'https://robin-agent.onrender.com'
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM || 'Robin <no-reply@robin-agent.app>',
      to: email,
      subject,
      text: `${body}\n\nContinue with Robin: ${appUrl}/frontend/robin_dashboard.html`
    })
  })
  if (!response.ok) throw new Error(`Resend failed: ${response.status}`)
}

async function recordEvent(row: any, stage: Stage, eventType: string, channel: Channel, decision: Decision | null, extra: Record<string, unknown> = {}) {
  await db.query(`
    INSERT INTO lifecycle_events (user_id, conversation_id, stage, event_type, channel, reason, urgency, payload_json)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
  `, [row.id, row.conversation_id, stage, eventType, channel, decision?.reason || null, decision?.urgency || null, JSON.stringify({ ...extra, message: decision?.body || null, score: decision?.score || null })])
}

router.post('/internal/nudges/run', async (req, res, next) => {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
    if (!process.env.NUDGE_SECRET || token !== process.env.NUDGE_SECRET) return res.status(401).json({ error: 'unauthorized' })

    const limit = Number(req.body?.limit || 50)
    const dryRun = Boolean(req.body?.dryRun)

    const { rows } = await db.query(`
      SELECT u.id, u.phone_e164, u.email, u.last_inbound_whatsapp_at, u.lifecycle_stage, c.id as conversation_id, c.state_json, c.updated_at
      FROM users u
      JOIN conversations c ON c.user_id = u.id
      WHERE u.status = 'active'
      ORDER BY c.updated_at ASC
      LIMIT $1
    `, [limit])

    const results: any[] = []

    for (const row of rows) {
      const session = (row.state_json || {}) as Session
      const stage = lifecycleStage(session)
      const decision = chooseDecision(session, stage)
      const channel = decision ? chooseChannel(row) : 'none'

      if (!decision) {
        if (!dryRun) await recordEvent(row, stage, 'no_nudge_needed', 'none', null)
        results.push({ user_id: row.id, stage, sent: false, reason: 'no_nudge_needed' })
        continue
      }

      if (channel === 'none') {
        if (!dryRun) await recordEvent(row, stage, 'nudge_skipped_no_channel', 'none', decision)
        results.push({ user_id: row.id, stage, sent: false, reason: 'no_channel', preview: decision.body })
        continue
      }

      let sent = false
      let error = ''
      if (!dryRun) {
        try {
          if (channel === 'whatsapp') await sendWhatsApp(row.phone_e164, decision.body)
          if (channel === 'email') await sendEmail(row.email, decision.subject || 'Robin', decision.body)
          sent = true
        } catch (e) {
          error = e instanceof Error ? e.message : String(e)
        }

        session.messages = Array.isArray(session.messages) ? session.messages : []
        if (sent) {
          session.messages.push({ role: 'assistant', content: decision.body })
          ;(session as any).lastNudgedAt = new Date().toISOString()
          ;(session as any).nudgeCount = Number((session as any).nudgeCount || 0) + 1
          ;(session as any).lastNudgeReason = decision.reason
          await db.query(`UPDATE conversations SET state_json=$1, updated_at=now() WHERE id=$2`, [JSON.stringify(session), row.conversation_id])
          await db.query(`UPDATE users SET lifecycle_stage=$1, lifecycle_updated_at=now(), last_nudged_at=now(), last_nudge_channel=$2 WHERE id=$3`, [stage, channel, row.id])
          await recordEvent(row, stage, 'nudge_sent', channel, decision)
        } else {
          await recordEvent(row, stage, 'nudge_failed', channel, decision, { error })
        }
      }

      results.push({ user_id: row.id, stage, channel, sent: dryRun ? false : sent, dryRun, reason: decision.reason, urgency: decision.urgency, score: decision.score, preview: decision.body, error: error || undefined })
    }

    res.json({ ok: true, dryRun, checked: rows.length, results })
  } catch (err) { next(err) }
})

export default router
