/**
 * EmailAccount model — Gmail connection state and notification tracking
 */

import { loadUser, saveUser, loadSession, saveSession } from '../lib/db.js'
import { getLatestId, getEmailProfile } from '../lib/gmail.js'

export async function getGmailStatus(sessionId) {
  const user = await loadUser(sessionId)
  return {
    connected: !!user?.gmail_tokens,
    email:     user?.gmail_email || null,
  }
}

export async function saveGmailConnection(sessionId, tokens) {
  const user    = (await loadUser(sessionId)) || {}
  const profile = await getEmailProfile(tokens)
  user.gmail_tokens = tokens
  user.gmail_email  = profile.email
  await saveUser(sessionId, user)

  // Baseline for polling
  const session     = await loadSession(sessionId)
  const latestId    = await getLatestId(tokens)
  session.gmail_last_id = latestId
  await saveSession(sessionId, session)

  return { email: profile.email }
}

export async function disconnectGmail(sessionId) {
  const user = await loadUser(sessionId)
  if (user) {
    delete user.gmail_tokens
    delete user.gmail_email
    await saveUser(sessionId, user)
  }
}
