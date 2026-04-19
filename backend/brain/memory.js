/**
 * Robin memory helpers — fact extraction, context building
 */

import { loadSession, saveSession } from '../lib/db.js'

export async function rememberFact(sessionId, fact) {
  const session = await loadSession(sessionId)
  session.facts = session.facts || []
  if (!session.facts.includes(fact)) session.facts.push(fact)
  await saveSession(sessionId, session)
  return session.facts
}

export async function getFacts(sessionId) {
  const session = await loadSession(sessionId)
  return session.facts || []
}

export async function clearFacts(sessionId) {
  const session = await loadSession(sessionId)
  session.facts = []
  await saveSession(sessionId, session)
}

export function extractFactsFromText(text) {
  // Pull structured facts from Robin's MEMORY_START blocks
  const match = text.match(/MEMORY_START([\s\S]*?)MEMORY_END/)
  if (!match) return []
  return match[1].trim().split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean)
}
