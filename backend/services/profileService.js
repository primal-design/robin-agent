/**
 * Profile service — user profile management
 */

import { loadUser, saveUser, loadProfile, saveProfile, deleteProfile } from '../lib/db.js'

export async function getUserProfile(sessionId) {
  const [user, profile] = await Promise.all([loadUser(sessionId), loadProfile(sessionId)])
  return {
    name:            user?.name || null,
    email:           user?.email || null,
    phone:           user?.phone || null,
    role:            user?.role || null,
    gmail_email:     user?.gmail_email || null,
    profile_summary: profile?.summary || null,
    consented_at:    user?.consented_at || null,
  }
}

export async function updateProfile(sessionId, patch) {
  const user    = (await loadUser(sessionId)) || {}
  const updated = { ...user, ...patch, updated_at: new Date().toISOString() }
  await saveUser(sessionId, updated)
  return updated
}
