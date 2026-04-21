import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import type { Session } from '../db/client.js'

let _ai: Anthropic | null = null
function ai() { return _ai || (_ai = new Anthropic({ apiKey: env.anthropicKey })) }

// ── Permission matrix ─────────────────────────────────────────────────────
export const PERMISSIONS = {
  AUTO: ['remember_fact','update_milestone','search_web','find_leads','draft_content',
         'analyse_competitor','generate_plan','research','log_task_done'],
  NEEDS_APPROVAL: ['send_message','post_to_social','send_email','create_stripe_link'],
  NEVER: ['access_private_data','send_without_approval','share_user_data'],
}

export function canAutoExecute(toolName: string) { return PERMISSIONS.AUTO.includes(toolName) }
export function needsApproval(toolName: string)  { return PERMISSIONS.NEEDS_APPROVAL.includes(toolName) }

// ── Time helpers ──────────────────────────────────────────────────────────
export function hoursSince(iso: string | null | undefined) {
  if (!iso) return 9999
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60)
}

// ── User context ──────────────────────────────────────────────────────────
export function buildUserContext(session: Session, profile?: unknown) {
  const silenceHours = hoursSince(session.lastActive || session.savedAt)
  const hour = new Date().getHours()
  const day  = new Date().getDay()
  const prof = profile as { summary?: string } | null

  return {
    goal:           session.facts?.find((f: string) => f.startsWith('Goal:'))?.replace('Goal:', '').trim() || null,
    niche:          session.facts?.find((f: string) => f.startsWith('Niche:'))?.replace('Niche:', '').trim() || null,
    streak:         session.streak || 0,
    tasks_done:     session.tasks_done || 0,
    total_earned:   session.total_earned || 0,
    facts:          session.facts || [],
    last_active:    session.lastActive || session.savedAt || null,
    rejection_round: session.rejection_round || 0,
    silence_hours:  silenceHours,
    silence_days:   silenceHours / 24,
    streak_at_risk: session.streak > 0 && silenceHours > 20,
    near_first_win: (session.tasks_done || 0) >= 3 && (session.total_earned || 0) < 100,
    hit_hundred:    (session.total_earned || 0) >= 100,
    stuck:          silenceHours > 48 && (session.tasks_done || 0) === 0,
    profile_summary: prof?.summary || null,
    time_of_day:    hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening',
    day_of_week:    new Date().toLocaleDateString('en-GB', { weekday: 'long' }),
    is_monday:      day === 1,
    is_morning:     hour < 12,
    is_weekend:     [0, 6].includes(day),
  }
}

// ── Triggers ──────────────────────────────────────────────────────────────
type Ctx = ReturnType<typeof buildUserContext>

export const TRIGGERS = [
  {
    name: 'streak_at_risk',
    check: (c: Ctx) => c.streak_at_risk,
    message: (c: Ctx) => `Your ${c.streak}-day streak ends in ${Math.round(24 - c.silence_hours)} hours — what's one thing you can do right now? 🦊`
  },
  {
    name: 'stuck_at_zero',
    check: (c: Ctx) => c.stuck && !c.goal,
    message: () => `You haven't started yet — that's fine. Tell me one thing you're good at. Anything. 🦊`
  },
  {
    name: 'near_first_win',
    check: (c: Ctx) => c.near_first_win && c.silence_hours > 12,
    message: (c: Ctx) => `You're ${c.tasks_done} tasks in — close to that first £100. What happened today? 🦊`
  },
  {
    name: 'monday_reset',
    check: (c: Ctx) => c.is_monday && c.is_morning && c.silence_hours > 8,
    message: (c: Ctx) => `New week — what's the ONE thing that would make this week a win for your ${c.niche || 'hustle'}? 🦊`
  },
]

export function checkTriggers(ctx: Ctx) {
  return TRIGGERS.filter(t => t.check(ctx))
}

// ── Autonomous decision ───────────────────────────────────────────────────
export async function autonomousDecision(session: Session, profile?: unknown) {
  const ctx = buildUserContext(session, profile)
  const res = await ai().messages.create({
    model: 'claude-sonnet-4-6', max_tokens: 400,
    system: `You are Robin — a side hustle mentor making a proactive decision about a user WITHOUT being asked.
Choose exactly ONE action:
A) MORNING_PUSH B) STREAK_WARNING C) STUCK_RESCUE D) WIN_CELEBRATE E) LEAD_NUDGE F) WEEK_REVIEW G) NOTHING
Rules: Pick the most relevant. Write SHORT message (2 sentences max). End with 🦊. If NOTHING: {"action":"NOTHING"}
Return JSON: {"action":"X","message":"..."}`,
    messages: [{ role: 'user', content: `User context:\n${JSON.stringify(ctx, null, 2)}` }]
  })
  try {
    const text = res.content[0].type === 'text' ? res.content[0].text : ''
    const json = text.match(/\{[\s\S]*\}/)
    return json ? JSON.parse(json[0]) as { action: string; message?: string } : { action: 'NOTHING' }
  } catch { return { action: 'NOTHING' } }
}

// ── Approval handler ──────────────────────────────────────────────────────
export async function handleApproval(pendingAction: Record<string, unknown>, session: Session) {
  switch (pendingAction.type) {
    case 'send_outreach': {
      session.pending_followups = session.pending_followups || []
      ;(session.pending_followups as unknown[]).push({
        recipient: pendingAction.recipient,
        due_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        context: String(pendingAction.draft || '').slice(0, 100)
      })
      return { executed: true, channel: 'draft_ready', message: pendingAction.draft,
        followup: `Drafted and ready to send to ${pendingAction.recipient}. Copy and send it — I'll remind you to follow up in 48hrs. 🦊` }
    }
    case 'create_stripe_link':
      return { executed: false, channel: 'instructions',
        followup: `Go to stripe.com/links → create a payment link → set price to ${(pendingAction.params as { price?: string })?.price || '£X'} → paste to client. 🦊` }
    case 'post_to_social':
      return { executed: false, channel: 'draft_ready', draft: pendingAction.draft,
        followup: `Here's the post — copy and post it yourself.\n\n${pendingAction.draft} 🦊` }
    default:
      return { executed: false, followup: `Done — what's next? 🦊` }
  }
}
