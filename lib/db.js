/**
 * Robin DB — Upstash Redis storage
 * Replaces memory.json — survives Render restarts
 * Falls back to in-memory if no Redis keys set
 */

import { Redis } from '@upstash/redis'
import { readFileSync, writeFileSync, existsSync } from 'fs'

// ── Redis client (or fallback) ────────────────────────────────────────────
let redis = null

if (process.env.REDIS_URL && process.env.REDIS_TOKEN) {
  redis = new Redis({
    url:   process.env.REDIS_URL,
    token: process.env.REDIS_TOKEN,
  })
  console.log('🗄  Redis connected (Upstash)')
} else {
  console.log('🗄  Redis not configured — using memory.json fallback')
}

// ── JSON file fallback ────────────────────────────────────────────────────
function loadFile()       { return existsSync('memory.json') ? JSON.parse(readFileSync('memory.json', 'utf8')) : {} }
function saveFile(store)  { writeFileSync('memory.json', JSON.stringify(store, null, 2)) }

// ── Session ───────────────────────────────────────────────────────────────
function normalise(s) {
  if (!s) return { messages: [], facts: [], streak: 0, tasks_done: 0, total_earned: 0, rejection_round: 0 }
  s.messages = Array.isArray(s.messages) ? s.messages : []
  s.facts     = Array.isArray(s.facts)    ? s.facts    : []
  return s
}

export async function loadSession(id) {
  if (redis) {
    const data = await redis.get(`session:${id}`)
    return normalise(data)
  }
  const store = loadFile()
  return normalise(store[id])
}

export async function saveSession(id, data) {
  const payload = { ...data, lastActive: new Date().toISOString() }
  if (redis) {
    await redis.set(`session:${id}`, payload, { ex: 60 * 60 * 24 * 90 }) // 90 day TTL
    return
  }
  const store = loadFile()
  store[id] = payload
  saveFile(store)
}

// ── User account ──────────────────────────────────────────────────────────
export async function loadUser(sessionId) {
  if (redis) return await redis.get(`user:${sessionId}`)
  return loadFile()[`user_${sessionId}`] || null
}

export async function saveUser(sessionId, data) {
  if (redis) {
    await redis.set(`user:${sessionId}`, data, { ex: 60 * 60 * 24 * 365 })
    return
  }
  const store = loadFile()
  store[`user_${sessionId}`] = data
  saveFile(store)
}

// ── Profile ───────────────────────────────────────────────────────────────
export async function loadProfile(sessionId) {
  if (redis) {
    const p = await redis.get(`profile:${sessionId}`)
    if (!p) return null
    if (Date.now() - new Date(p.created_at).getTime() > 30 * 24 * 60 * 60 * 1000) {
      await redis.del(`profile:${sessionId}`)
      return null
    }
    return p
  }
  const store = loadFile()
  const p = store[`profile_${sessionId}`]
  if (!p) return null
  if (Date.now() - new Date(p.created_at).getTime() > 30 * 24 * 60 * 60 * 1000) {
    delete store[`profile_${sessionId}`]; saveFile(store); return null
  }
  return p
}

export async function saveProfile(sessionId, sourceType, rawData, summary) {
  const data = { source_type: sourceType, raw_data: rawData.slice(0, 5000), summary, created_at: new Date().toISOString() }
  if (redis) {
    await redis.set(`profile:${sessionId}`, data, { ex: 60 * 60 * 24 * 30 }) // 30 day TTL
    return
  }
  const store = loadFile()
  store[`profile_${sessionId}`] = data
  saveFile(store)
}

export async function deleteProfile(sessionId) {
  if (redis) { await redis.del(`profile:${sessionId}`); return }
  const store = loadFile(); delete store[`profile_${sessionId}`]; saveFile(store)
}

// ── GDPR — export all user data ───────────────────────────────────────────
export async function exportUserData(sessionId) {
  const [session, profile, user] = await Promise.all([
    loadSession(sessionId),
    loadProfile(sessionId),
    loadUser(sessionId)
  ])
  return {
    user_id:      sessionId,
    account:      user ? { name: user.name, email: user.email, consented_at: user.consented_at } : null,
    profile:      profile ? { summary: profile.summary, source_type: profile.source_type, created_at: profile.created_at, deletes_after: '30 days' } : null,
    facts:        session.facts || [],
    milestones:   session.milestones || [],
    streak:       session.streak || 0,
    total_earned: session.total_earned || 0,
    rights:       { can_export: true, can_delete: true }
  }
}

export async function deleteAccount(sessionId) {
  if (redis) {
    await Promise.all([
      redis.del(`session:${sessionId}`),
      redis.del(`profile:${sessionId}`),
      redis.del(`user:${sessionId}`)
    ])
    return
  }
  const store = loadFile()
  delete store[sessionId]; delete store[`profile_${sessionId}`]; delete store[`user_${sessionId}`]
  saveFile(store)
}

export async function clearMemory(sessionId) {
  const session = await loadSession(sessionId)
  session.facts = []; session.messages = []
  await saveSession(sessionId, session)
}
