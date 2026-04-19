/**
 * Memory service — facts, milestones, context
 */

import { loadSession, saveSession } from '../lib/db.js'

export async function addFact(sessionId, fact) {
  const session = await loadSession(sessionId)
  session.facts = session.facts || []
  if (!session.facts.includes(fact)) {
    session.facts.push(fact)
    await saveSession(sessionId, session)
  }
  return session.facts
}

export async function deleteFact(sessionId, fact) {
  const session = await loadSession(sessionId)
  session.facts = (session.facts || []).filter(f => f !== fact)
  await saveSession(sessionId, session)
  return session.facts
}

export async function getMemorySummary(sessionId) {
  const session = await loadSession(sessionId)
  return {
    facts:      session.facts || [],
    milestones: session.milestones || [],
    streak:     session.streak || 0,
    tasks_done: session.tasks_done || 0,
    total_earned: session.total_earned || 0,
  }
}
