/**
 * Action model — pending actions feed
 */

import { loadSession, saveSession } from '../lib/db.js'

export async function getPendingActions(sessionId) {
  const session = await loadSession(sessionId)
  return (session.pending_actions || [])
    .slice(-20)
    .reverse()
    .map(a => ({
      id:         a.id,
      type:       a.type,
      title:      a.type === 'draft_email'  ? `Reply to ${a.to}` :
                  a.type === 'send_message' ? `Message to ${a.recipient}` :
                  a.title || 'Action ready',
      body:       a.body || a.draft || '',
      to:         a.to || a.recipient || '',
      subject:    a.subject || '',
      risk:       a.risk || 'medium',
      created_at: a.created_at,
    }))
}

export async function addAction(sessionId, action) {
  const session = await loadSession(sessionId)
  session.pending_actions = session.pending_actions || []
  session.pending_actions.push(action)
  await saveSession(sessionId, session)
  return action
}

export async function removeAction(sessionId, actionId) {
  const session = await loadSession(sessionId)
  session.pending_actions = (session.pending_actions || []).filter(a => a.id !== actionId)
  if (session.pending_action?.id === actionId) session.pending_action = null
  await saveSession(sessionId, session)
}

export async function findAction(sessionId, actionId) {
  const session = await loadSession(sessionId)
  return (session.pending_actions || []).find(a => a.id === actionId) || null
}

export function buildAction(type, data) {
  return {
    id:         Date.now().toString(),
    type,
    risk:       data.risk || 'medium',
    created_at: new Date().toISOString(),
    ...data,
  }
}
