import { Router } from 'express'
import crypto from 'crypto'
import { chatService } from '../services/chat.service.js'

const router = Router()
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7

function normalizePhone(phone: string) {
  const raw = String(phone || '').trim()
  if (!raw) return ''
  return raw.startsWith('+') ? raw : `+${raw.replace(/[^0-9]/g, '')}`
}

function authSecret() {
  return process.env.ROBIN_AUTH_SECRET || process.env.SESSION_SECRET || process.env.TWILIO_AUTH_TOKEN || 'dev-fen-auth-secret'
}

function signPayload(payload: string) {
  return crypto.createHmac('sha256', authSecret()).update(payload).digest('base64url')
}

function createSessionToken(phone: string) {
  const payload = Buffer.from(JSON.stringify({ phone, exp: Date.now() + SESSION_TTL_MS })).toString('base64url')
  return `rt_${payload}.${signPayload(payload)}`
}

function readSessionToken(token: string): { phone: string; expired: boolean } | null {
  const raw = String(token || '').trim()
  if (!raw) return null

  if (raw.startsWith('rt_')) {
    const [payload, sig] = raw.slice(3).split('.')
    if (!payload || !sig || signPayload(payload) !== sig) return null
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
      return { phone: normalizePhone(data.phone), expired: Number(data.exp || 0) <= Date.now() }
    } catch {
      return null
    }
  }

  // Legacy tokens are accepted during migration but cannot carry expiry.
  if (raw.startsWith('tok_')) {
    try {
      const decoded = Buffer.from(raw.slice(4), 'base64').toString()
      return { phone: normalizePhone(decoded.split(':')[0]?.trim() || ''), expired: false }
    } catch {
      return null
    }
  }

  if (raw.startsWith('sid_')) return { phone: normalizePhone(raw.slice(4)), expired: false }
  return { phone: normalizePhone(raw), expired: false }
}

function getBearer(req: any) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
}

function requireSession(req: any, res: any) {
  const session = readSessionToken(getBearer(req))
  if (!session?.phone) {
    res.status(401).json({ error: 'missing_session', message: 'Please sign in again.' })
    return null
  }
  if (session.expired) {
    res.status(401).json({ error: 'session_expired', message: 'Your session expired. Please sign in again.' })
    return null
  }
  return session
}

router.post('/chat', async (req, res, next) => {
  try {
    const { message, sessionId } = req.body
    if (!message) return res.status(400).json({ error: 'No message' })

    const session = readSessionToken(getBearer(req))
    const identifier = session?.phone || normalizePhone(String(sessionId || '')) || String(req.ip || 'anonymous')
    const { findOrCreateUser } = await import('../db/client.js')
    const userId = await findOrCreateUser(identifier)
    const reply  = await chatService(userId, message)
    res.json({ type: 'response', reply })
  } catch (err) { next(err) }
})

router.post('/signup', async (req, res, next) => {
  try {
    const name  = String(req.body.name  || '').trim()
    const email = String(req.body.email || '').trim().toLowerCase()
    if (!name || !email) return res.status(400).json({ error: 'Name and email required' })

    const { db } = await import('../db/client.js')

    // Return existing request if email already on waitlist
    const existing = await db.query(
      `SELECT request_id, name, submitted_at FROM waitlist WHERE LOWER(email)=$1 LIMIT 1`,
      [email]
    )

    if (existing.rows.length > 0) {
      const row = existing.rows[0]
      return res.json({
        request_id: row.request_id,
        name: row.name || name,
        submitted: new Date(row.submitted_at || Date.now()).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' }),
        already_exists: true,
      })
    }

    const requestId = 'R-' + Date.now().toString(36).toUpperCase().slice(-6)
    const submitted = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })

    await db.query(
      `INSERT INTO waitlist (request_id, name, email, status) VALUES ($1,$2,$3,'pending')`,
      [requestId, name, email]
    )

    res.json({ request_id: requestId, submitted, name })
  } catch (err) { next(err) }
})

router.post('/waitlist/check', async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase()
    if (!email) return res.status(400).json({ error: 'Email required' })
    const { db } = await import('../db/client.js')
    const result = await db.query(
      `SELECT request_id, name, submitted_at FROM waitlist WHERE LOWER(email)=$1 LIMIT 1`,
      [email]
    )
    if (result.rows.length > 0) {
      const row = result.rows[0]
      return res.json({
        exists: true,
        request_id: row.request_id,
        name: row.name,
        submitted: new Date(row.submitted_at || Date.now()).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })
      })
    }
    res.json({ exists: false })
  } catch (err) { next(err) }
})


export default router

// ── DASHBOARD ROUTES ──────────────────────────────────────
router.get('/profile', async (req, res, next) => {
  try {
    const session = requireSession(req, res)
    if (!session) return
    const { db } = await import('../db/client.js')
    const result = await db.query(`SELECT name, role FROM waitlist WHERE phone=$1 LIMIT 1`, [session.phone])
    res.json({
      name: result.rows[0]?.name || '',
      role: result.rows[0]?.role || '',
    })
  } catch (err) { next(err) }
})

router.post('/pulse', async (req, res, next) => {
  try {
    const session = requireSession(req, res)
    if (!session) return
    res.json({
      stats: { pending: 0, handled: 0, streak: 0, total_earned: 0 },
      triggered: false,
      message: 'All clear today.'
    })
  } catch (err) { next(err) }
})

router.get('/actions/:sessionId', async (req, res, next) => {
  try {
    const session = requireSession(req, res)
    if (!session) return
    res.json({ actions: [] })
  } catch (err) { next(err) }
})

router.post('/actions/:actionId/approve', async (req, res, next) => {
  const session = requireSession(req, res)
  if (!session) return
  res.json({ ok: true })
})
