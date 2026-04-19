/**
 * Robin Brain — autonomous intelligence layer
 *
 * Implements the OpenClaw pattern:
 * - Full context window on every decision
 * - Autonomous morning decisions without being asked
 * - Permission matrix (auto / approval / never)
 * - Ambient context (time, state, patterns)
 * - Trigger-based actions on state changes
 * - Immediate execution on approval
 */

import Anthropic from '@anthropic-ai/sdk'

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })

// ── Permission matrix ─────────────────────────────────────────────────────
export const PERMISSIONS = {
  AUTO: [
    'remember_fact',
    'update_milestone',
    'search_web',
    'find_leads',
    'draft_content',
    'analyse_competitor',
    'generate_plan',
    'research',
    'log_task_done',
  ],
  NEEDS_APPROVAL: [
    'send_message',
    'post_to_social',
    'send_email',
    'create_stripe_link',
  ],
  NEVER: [
    'access_private_data',
    'send_without_approval',
    'share_user_data',
  ]
}

export function canAutoExecute(toolName) {
  return PERMISSIONS.AUTO.includes(toolName)
}

export function needsApproval(toolName) {
  return PERMISSIONS.NEEDS_APPROVAL.includes(toolName)
}

// ── Time helpers ──────────────────────────────────────────────────────────
export function hoursSince(isoString) {
  if (!isoString) return 9999
  return (Date.now() - new Date(isoString).getTime()) / (1000 * 60 * 60)
}

export function daysSince(isoString) {
  return hoursSince(isoString) / 24
}

function getCurrentHour()  { return new Date().getHours() }
function getCurrentDay()   { return new Date().toLocaleDateString('en-GB', { weekday: 'long' }) }
function isMonday()        { return new Date().getDay() === 1 }
function isMorning()       { return getCurrentHour() < 12 }
function isWeekend()       { return [0, 6].includes(new Date().getDay()) }

// ── Build full user context ───────────────────────────────────────────────
export function buildUserContext(session, profile) {
  const silenceHours = hoursSince(session.lastActive || session.savedAt)

  return {
    goal:           session.facts?.find(f => f.startsWith('Goal:'))?.replace('Goal:', '').trim() || null,
    niche:          session.facts?.find(f => f.startsWith('Niche:'))?.replace('Niche:', '').trim() || null,
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

    profile_summary: profile?.summary || null,

    time_of_day:    getCurrentHour() < 12 ? 'morning' : getCurrentHour() < 17 ? 'afternoon' : 'evening',
    day_of_week:    getCurrentDay(),
    is_monday:      isMonday(),
    is_morning:     isMorning(),
    is_weekend:     isWeekend(),
  }
}

// ── Autonomous morning decision ───────────────────────────────────────────
export async function autonomousDecision(sessionId, session, profile) {
  const ctx = buildUserContext(session, profile)

  const decision = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: `You are Robin — a side hustle mentor making a proactive decision about a user WITHOUT being asked.

You have full context on this person. Choose exactly ONE action:

A) MORNING_PUSH    — they need momentum to start the day
B) STREAK_WARNING  — streak is at risk, they haven't been active 20+ hours
C) STUCK_RESCUE    — they've been silent 48+ hours and haven't started
D) WIN_CELEBRATE   — they just hit a milestone, celebrate it
E) LEAD_NUDGE      — remind them to follow up on their leads
F) WEEK_REVIEW     — it's Monday, time to set the week's one goal
G) NOTHING         — they're active and doing fine, don't interrupt

Rules:
- Pick the MOST relevant one for this exact person right now
- Write a SHORT message (2 sentences max) as Robin would say it
- End with 🦊
- If NOTHING, just return {"action": "NOTHING"}

Return JSON: {"action": "X", "message": "..."}`,
    messages: [{ role: 'user', content: `User context:\n${JSON.stringify(ctx, null, 2)}` }]
  })

  try {
    const text = decision.content[0].text
    const json = text.match(/\{[\s\S]*\}/)
    return json ? JSON.parse(json[0]) : { action: 'NOTHING' }
  } catch {
    return { action: 'NOTHING' }
  }
}

// ── Trigger definitions ───────────────────────────────────────────────────
export const TRIGGERS = [
  {
    name: 'silent_too_long',
    check: (ctx) => ctx.silence_hours > 28 && ctx.streak > 0,
    message: (ctx) => `Hey — you've been quiet for a bit. Last thing you did was ${ctx.facts.slice(-1)[0] || 'get started'}. Still on it? 🦊`
  },
  {
    name: 'streak_at_risk',
    check: (ctx) => ctx.streak_at_risk,
    message: (ctx) => `Your ${ctx.streak}-day streak ends in ${Math.round(24 - ctx.silence_hours)} hours — what's one thing you can do right now? 🦊`
  },
  {
    name: 'stuck_at_zero',
    check: (ctx) => ctx.stuck && !ctx.goal,
    message: () => `You haven't started yet — that's fine. Tell me one thing you're good at. Anything. 🦊`
  },
  {
    name: 'near_first_win',
    check: (ctx) => ctx.near_first_win && ctx.silence_hours > 12,
    message: (ctx) => `You're ${ctx.tasks_done} tasks in — you're close to that first £100. What happened today? 🦊`
  },
  {
    name: 'monday_reset',
    check: (ctx) => ctx.is_monday && ctx.is_morning && ctx.silence_hours > 8,
    message: (ctx) => `New week — what's the ONE thing that would make this week a win for your ${ctx.niche || 'hustle'}? 🦊`
  }
]

export function checkTriggers(ctx) {
  return TRIGGERS.filter(t => t.check(ctx))
}

// ── Approval execution ────────────────────────────────────────────────────
export async function handleApproval(sessionId, pendingAction, session) {
  const results = []

  switch (pendingAction.type) {
    case 'send_outreach': {
      results.push({
        executed: true,
        channel: 'draft_ready',
        message: pendingAction.draft,
        followup: `I drafted this and it's ready to send to ${pendingAction.recipient}. Copy and send it — I'll remind you to follow up in 48hrs. 🦊`
      })
      session.pending_followups = session.pending_followups || []
      session.pending_followups.push({
        recipient: pendingAction.recipient,
        due_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
        context: pendingAction.draft?.slice(0, 100)
      })
      break
    }
    case 'create_stripe_link': {
      results.push({
        executed: false,
        channel: 'instructions',
        followup: `Go to stripe.com/links → create a payment link → set price to ${pendingAction.params?.price || '£X'} → paste the link to your client. 🦊`
      })
      break
    }
    case 'post_to_social': {
      results.push({
        executed: false,
        channel: 'draft_ready',
        draft: pendingAction.draft,
        followup: `Here's the post — copy it and post it yourself. I can't post for you yet but that's coming. 🦊\n\n${pendingAction.draft}`
      })
      break
    }
    default: {
      results.push({ executed: false, followup: `Done — what's next? 🦊` })
    }
  }

  return results[0]
}

// ── Craft a message given full user context ───────────────────────────────
export async function craftMessage(ctx, instruction) {
  const response = await ai.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 200,
    system: `You are Robin — a side hustle mentor. Write ONE short message (2 sentences max) based on the instruction. End with 🦊. No corporate language. Be direct.`,
    messages: [{ role: 'user', content: `User context: ${JSON.stringify(ctx)}\n\nInstruction: ${instruction}` }]
  })
  return response.content[0].text
}
