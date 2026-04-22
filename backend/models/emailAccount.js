/**
 * EmailAccount model — Gmail connection state and notification tracking
 */

import { loadUser, saveUser, loadSession, saveSession } from '../lib/db.js'
import { getLatestId, getEmailProfile } from '../lib/gmail.js'

function errorDetail(err) {
  const detail = err?.response?.data || err?.message || err
  if (!detail) return 'Unknown error'
  if (typeof detail === 'string') return detail
  if (detail instanceof Error) return detail.message || detail.name || 'Unknown error'

  const fields = [
    detail.error_description,
    detail.description,
    detail.message,
    detail.detail,
    detail.hint,
    detail.code,
    typeof detail.error === 'string' ? detail.error : '',
    typeof detail.error === 'object' && detail.error ? detail.error.error_description : '',
    typeof detail.error === 'object' && detail.error ? detail.error.message : '',
    typeof detail.error === 'object' && detail.error ? detail.error.status : '',
  ]

  const match = fields.find(item => typeof item === 'string' && item.trim())
  if (match) return match

  try {
    return JSON.stringify(detail, null, 2)
  } catch {
    return Object.prototype.toString.call(detail)
  }
}

function withContext(step, err) {
  const wrapped = new Error(`${step}: ${errorDetail(err)}`)
  wrapped.cause = err
  return wrapped
}

export async function getGmailStatus(sessionId) {
  const user = await loadUser(sessionId)
  return {
    connected: !!user?.gmail_tokens,
    email:     user?.gmail_email || null,
  }
}

export async function saveGmailConnection(sessionId, tokens) {
  let user
  try {
    user = (await loadUser(sessionId)) || {}
  } catch (err) {
    throw withContext('Connected to Google but failed to load the current user from storage', err)
  }

  let profile
  try {
    profile = await getEmailProfile(tokens)
  } catch (err) {
    throw withContext('Connected to Google but failed to read the Gmail profile', err)
  }

  user.gmail_tokens = tokens
  user.gmail_email  = profile.email
  try {
    await saveUser(sessionId, user)
  } catch (err) {
    throw withContext('Connected to Google but failed to save Gmail tokens to storage', err)
  }

  // Baseline for polling
  let session
  try {
    session = await loadSession(sessionId)
  } catch (err) {
    throw withContext('Connected to Google but failed to load the session state', err)
  }

  let latestId
  try {
    latestId = await getLatestId(tokens)
  } catch (err) {
    throw withContext('Connected to Google but failed to query the inbox baseline', err)
  }

  session.gmail_last_id = latestId
  try {
    await saveSession(sessionId, session)
  } catch (err) {
    throw withContext('Connected to Google but failed to save the inbox baseline', err)
  }

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
