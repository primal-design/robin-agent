/**
 * User model — account, consent, Gmail tokens
 */

import { loadUser, saveUser, deleteAccount } from '../lib/db.js'

export async function getUser(sessionId) {
  return await loadUser(sessionId)
}

export async function createUser(sessionId, { name, email, phone, role, cracks, note, gdpr_consent }) {
  const user = {
    name,
    email,
    phone,
    role,
    cracks,
    note,
    gdpr_consent: !!gdpr_consent,
    consented_at: new Date().toISOString(),
    created_at:   new Date().toISOString(),
  }
  await saveUser(sessionId, user)
  return user
}

export async function updateUser(sessionId, patch) {
  const existing = (await loadUser(sessionId)) || {}
  const updated  = { ...existing, ...patch, updated_at: new Date().toISOString() }
  await saveUser(sessionId, updated)
  return updated
}

export async function removeUser(sessionId) {
  await deleteAccount(sessionId)
}

export async function setGmailTokens(sessionId, tokens, gmailEmail) {
  const user = (await loadUser(sessionId)) || {}
  user.gmail_tokens = tokens
  user.gmail_email  = gmailEmail
  await saveUser(sessionId, user)
}

export async function getGmailTokens(sessionId) {
  const user = await loadUser(sessionId)
  return user?.gmail_tokens || null
}

export async function revokeGmail(sessionId) {
  const user = await loadUser(sessionId)
  if (user) {
    delete user.gmail_tokens
    delete user.gmail_email
    await saveUser(sessionId, user)
  }
}
