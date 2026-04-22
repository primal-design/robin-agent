import pg from 'pg'
import { env } from '../config/env.js'

const { Pool } = pg

export const db = new Pool({
  connectionString: env.databaseUrl,
  ssl: env.databaseUrl.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  max: 10,
})

// ── Session helpers (replaces memory.json / Redis) ────────────────────────
export interface Session {
  userId?:          string
  messages:         { role: string; content: unknown }[]
  facts:            string[]
  streak:           number
  tasks_done:       number
  total_earned:     number
  rejection_round:  number
  leads?:           unknown[]
  milestones?:      unknown[]
  pending_action?:  unknown
  pending_actions?: unknown[]
  pending_followups?: unknown[]
  trigger_shown?:   boolean
  lastActive?:      string
  savedAt?:         string
  [key: string]:    unknown
}

const DEFAULT = (): Session => ({
  messages: [], facts: [], streak: 0, tasks_done: 0,
  total_earned: 0, rejection_round: 0,
})

function normalise(s: unknown): Session {
  if (!s || typeof s !== 'object') return DEFAULT()
  const session = s as Partial<Session>
  session.messages = Array.isArray(session.messages) ? session.messages : []
  session.facts    = Array.isArray(session.facts)    ? session.facts    : []
  return session as Session
}

export async function loadSession(userId: string): Promise<Session> {
  try {
    const row = await db.query(
      `SELECT state_json FROM conversations WHERE user_id = $1 AND channel = 'whatsapp' LIMIT 1`,
      [userId]
    )
    return normalise(row.rows[0]?.state_json)
  } catch {
    return DEFAULT()
  }
}

export async function saveSession(userId: string, session: Session): Promise<void> {
  const payload = { ...session, lastActive: new Date().toISOString() }
  await db.query(`
    INSERT INTO conversations (user_id, channel, state_json, last_message_at, updated_at)
    VALUES ($1, 'whatsapp', $2, now(), now())
    ON CONFLICT (user_id, channel)
    DO UPDATE SET state_json = $2, last_message_at = now(), updated_at = now()
  `, [userId, JSON.stringify(payload)])
}

// ── User helpers ──────────────────────────────────────────────────────────
export async function findOrCreateUser(phoneE164: string): Promise<string> {
  const existing = await db.query(
    'SELECT id FROM users WHERE phone_e164 = $1',
    [phoneE164]
  )
  if (existing.rows[0]) return existing.rows[0].id

  const created = await db.query(
    'INSERT INTO users (phone_e164) VALUES ($1) RETURNING id',
    [phoneE164]
  )
  return created.rows[0].id
}
