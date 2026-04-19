/**
 * Session model — conversation state and memory
 */

import { loadSession, saveSession, clearMemory, exportUserData } from '../lib/db.js'

export async function getSession(sessionId) {
  return await loadSession(sessionId)
}

export async function updateSession(sessionId, patch) {
  const session = await loadSession(sessionId)
  const updated = { ...session, ...patch }
  await saveSession(sessionId, updated)
  return updated
}

export async function resetMemory(sessionId) {
  await clearMemory(sessionId)
}

export async function exportData(sessionId) {
  return await exportUserData(sessionId)
}

export function emptySession() {
  return {
    messages:         [],
    facts:            [],
    streak:           0,
    tasks_done:       0,
    total_earned:     0,
    rejection_round:  0,
    pending_actions:  [],
  }
}
