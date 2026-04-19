/**
 * Robin Signal Engine
 * Detects intent signals across messages, determines trigger threshold,
 * and generates paywall payloads when limits are hit.
 */

// ── Signal detection ──────────────────────────────────────────────────────
const SIGNAL_PATTERNS = {
  money_stress:   /rent|broke|need money|can't afford|bills|skint|struggling|debt|no income|tight|desperate/i,
  skill_mention:  /i can|i'm good at|i used to|people ask me|i know how to|my background|i work in|i've done|my job is/i,
  time_available: /evenings|only work|spare time|free most|been slow|3 days|weekends|part.?time|few hours/i,
  task_avoidance: /later|not sure|too many|overwhelmed|don't know where|too much|confusing|complicated|where do i start/i,
  frustration:    /tired of|stuck|bored|hate my job|going nowhere|need a change|fed up|done with|sick of/i,
  ambition:       /want to|thinking about|dream of|i'd love to|what if|been meaning|always wanted|considering/i,
}

const SIGNAL_WEIGHTS = {
  money_stress:   'HIGH',
  task_avoidance: 'HIGH',
  skill_mention:  'MEDIUM',
  time_available: 'MEDIUM',
  frustration:    'LOW',
  ambition:       'LOW',
}

export function detectSignals(messages = []) {
  const text = messages
    .filter(m => m.role === 'user')
    .slice(-10)
    .map(m => typeof m.content === 'string' ? m.content : '')
    .join(' ')

  const detected = {}
  for (const [signal, pattern] of Object.entries(SIGNAL_PATTERNS)) {
    if (pattern.test(text)) detected[signal] = SIGNAL_WEIGHTS[signal]
  }
  return detected
}

export function shouldTrigger(signals) {
  const weights = Object.values(signals)
  if (weights.includes('HIGH')) return true
  if (weights.filter(w => w === 'MEDIUM').length >= 2) return true
  if (weights.includes('MEDIUM') && weights.includes('LOW')) return true
  return false
}

export function getTriggerRoute(signals) {
  if (signals.money_stress)   return { primary: "Make your first £100 this week",         signal: 'money_stress' }
  if (signals.skill_mention)  return { primary: "Turn your skill into a paid offer",       signal: 'skill_mention' }
  if (signals.time_available) return { primary: "Find something that fits your schedule",  signal: 'time_available' }
  if (signals.frustration)    return { primary: "Build an exit from where you are",        signal: 'frustration' }
  if (signals.ambition)       return { primary: "Start the thing you mentioned",           signal: 'ambition' }
  if (signals.task_avoidance) return { primary: "One move — no planning needed",           signal: 'task_avoidance' }
  return null
}

// ── Free action limits ────────────────────────────────────────────────────
const FREE_LIMIT = 10  // smart actions (research, leads, drafts) per session

export function getSmartCallsUsed(session) {
  return session.smart_calls_used || 0
}

export function incrementSmartCalls(session) {
  session.smart_calls_used = (session.smart_calls_used || 0) + 1
  return session
}

export function isAtLimit(session) {
  return getSmartCallsUsed(session) >= FREE_LIMIT
}

// ── Paywall payload ───────────────────────────────────────────────────────
export function buildPaywall(session, nextAction) {
  const done = session.milestones?.map(m => m.milestone) || session.facts?.slice(0, 3) || []

  return {
    message:        "I've got the next steps ready — this is where full execution unlocks.",
    completedSteps: done,
    unlocksNext:    nextAction || "Full lead list, drafted outreach, and 21-day plan",
    cta:            "Unlock full execution — £23/month",
    ctaUrl:         "/upgrade",
    smartCallsUsed: getSmartCallsUsed(session),
    smartCallsMax:  FREE_LIMIT,
  }
}
