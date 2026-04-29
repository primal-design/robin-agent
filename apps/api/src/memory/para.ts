import { db } from '../db/client.js'

export type ParaType    = 'project' | 'area' | 'resource' | 'archive'
export type ParaSection = 'what_happened' | 'robin_notes' | 'open_threads' | 'decisions'

export interface ParaNote {
  id:         string
  para_type:  ParaType
  title:      string
  section:    ParaSection
  content:    string
  created_at: string
}

// ── Auto-create tables if they don't exist ────────────────────────────────────
export async function ensureParaTables(): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS para_notes (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL,
      para_type   TEXT NOT NULL,
      title       TEXT NOT NULL,
      section     TEXT NOT NULL,
      content     TEXT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS para_notes_user_idx ON para_notes(user_id)`)

  await db.query(`
    CREATE TABLE IF NOT EXISTS daily_logs (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id     UUID NOT NULL,
      date        DATE NOT NULL DEFAULT CURRENT_DATE,
      role        TEXT NOT NULL,
      content     TEXT NOT NULL,
      logged_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await db.query(`CREATE INDEX IF NOT EXISTS daily_logs_user_date_idx ON daily_logs(user_id, date)`)
}

// ── Daily log ─────────────────────────────────────────────────────────────────
export async function appendDailyLog(userId: string, role: 'user' | 'robin', content: string): Promise<void> {
  try {
    await db.query(
      `INSERT INTO daily_logs (user_id, role, content) VALUES ($1, $2, $3)`,
      [userId, role, content.slice(0, 2000)]
    )
  } catch { /* silent — don't break main flow */ }
}

export async function getTodayLog(userId: string): Promise<string> {
  try {
    const rows = await db.query(
      `SELECT role, content, logged_at FROM daily_logs WHERE user_id=$1 AND date=CURRENT_DATE ORDER BY logged_at ASC LIMIT 50`,
      [userId]
    )
    if (!rows.rows.length) return ''
    return rows.rows.map((r: { role: string; content: string; logged_at: Date }) => {
      const time = new Date(r.logged_at).toTimeString().slice(0, 5)
      return `${time} [${r.role}]: ${r.content}`
    }).join('\n')
  } catch { return '' }
}

// ── PARA notes ────────────────────────────────────────────────────────────────
export async function appendParaNote(
  userId:    string,
  paraType:  ParaType,
  title:     string,
  section:   ParaSection,
  content:   string
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO para_notes (user_id, para_type, title, section, content) VALUES ($1,$2,$3,$4,$5)`,
      [userId, paraType, title, section, content.slice(0, 4000)]
    )
  } catch { /* silent */ }
}

export async function readParaNotes(userId: string, paraType?: ParaType, title?: string): Promise<ParaNote[]> {
  try {
    let query = `SELECT id, para_type, title, section, content, created_at FROM para_notes WHERE user_id=$1`
    const params: unknown[] = [userId]

    if (paraType) { params.push(paraType); query += ` AND para_type=$${params.length}` }
    if (title)    { params.push(`%${title}%`); query += ` AND title ILIKE $${params.length}` }

    query += ` ORDER BY created_at DESC LIMIT 30`
    const rows = await db.query(query, params)
    return rows.rows
  } catch { return [] }
}

export async function getParaSummary(userId: string): Promise<string> {
  try {
    const rows = await db.query(
      `SELECT para_type, title, section, content, created_at
       FROM para_notes WHERE user_id=$1
       ORDER BY created_at DESC LIMIT 20`,
      [userId]
    )
    if (!rows.rows.length) return ''

    const grouped: Record<string, string[]> = {}
    for (const r of rows.rows) {
      const key = `${r.para_type}:${r.title}`
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(`  [${r.section}] ${r.content.slice(0, 100)}`)
    }

    return Object.entries(grouped).map(([key, entries]) => {
      const [type, title] = key.split(':')
      return `${type.toUpperCase()} — ${title}\n${entries.join('\n')}`
    }).join('\n\n')
  } catch { return '' }
}

// ── PARA planner (Claude decides what to write) ───────────────────────────────
export interface ParaPlan {
  intent:       string
  para_type:    ParaType | null
  title:        string | null
  section:      ParaSection | null
  should_write: boolean
  note:         string | null
}

export async function planParaWrite(
  userMessage: string,
  robinReply:  string,
  existingSummary: string
): Promise<ParaPlan> {
  // Simple heuristic planner — no extra API call needed
  const text = userMessage.toLowerCase()

  const isProject    = /project|launch|build|create|start|ship|deadline|milestone|client|proposal/.test(text)
  const isArea       = /habit|routine|health|finance|career|relationship|skill|learning|weekly|monthly/.test(text)
  const isResource   = /how to|tutorial|guide|reference|notes on|research|info about|explain/.test(text)
  const isDecision   = /decided|going with|chose|picked|will use|going to/.test(text)
  const isOpenThread = /need to|follow up|waiting|remind me|not sure yet|later|pending/.test(text)
  const isWin        = /done|completed|finished|sent|closed|launched|shipped|earned/.test(text)

  if (!isProject && !isArea && !isResource && !isDecision && !isOpenThread && !isWin) {
    return { intent: 'conversation', para_type: null, title: null, section: null, should_write: false, note: null }
  }

  const para_type: ParaType =
    isProject ? 'project' :
    isArea    ? 'area'    :
    isResource ? 'resource' : 'project'

  const section: ParaSection =
    isDecision   ? 'decisions'     :
    isOpenThread ? 'open_threads'  :
    isWin        ? 'what_happened' : 'robin_notes'

  // Extract a short title from the message
  const title = userMessage.slice(0, 60).replace(/[^a-zA-Z0-9\s£]/g, '').trim() || 'General'

  return {
    intent: para_type,
    para_type,
    title,
    section,
    should_write: true,
    note: `${userMessage.slice(0, 200)} → ${robinReply.slice(0, 200)}`,
  }
}
