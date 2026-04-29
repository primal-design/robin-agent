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
  return process.env.ROBIN_AUTH_SECRET || process.env.SESSION_SECRET || process.env.TWILIO_AUTH_TOKEN || 'dev-robin-auth-secret'
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
    const { name, phone, role, cracks, note } = req.body
    const normalizedPhone = normalizePhone(phone)
    if (!name || !normalizedPhone) return res.status(400).json({ error: 'Name and phone required' })

    const { findOrCreateUser, db } = await import('../db/client.js')
    const userId = await findOrCreateUser(normalizedPhone)

    await db.query(`UPDATE users SET name=$1 WHERE id=$2`, [name, userId])

    // Return existing request if phone already on waitlist
    const existing = await db.query(
      `SELECT request_id, submitted_at FROM waitlist WHERE phone=$1 LIMIT 1`,
      [normalizedPhone]
    )

    let requestId: string
    let submitted: string
    let isNew = false

    if (existing.rows.length > 0) {
      requestId = existing.rows[0].request_id
      submitted = new Date(existing.rows[0].submitted_at).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })
    } else {
      requestId = 'R-' + Date.now().toString(36).toUpperCase().slice(-6)
      submitted = new Date().toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })
      isNew = true
      await db.query(
        `INSERT INTO waitlist (request_id, name, phone, role, cracks, note, status)
         VALUES ($1,$2,$3,$4,$5,$6,'accepted')`,
        [requestId, name, normalizedPhone, role||null, cracks||null, note||null]
      )
    }

    // Send WhatsApp confirmation only for new signups
    if (!isNew) return res.json({ request_id: requestId, submitted, name })

    try {
      const twilio = (await import('twilio')).default
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to:   `whatsapp:${normalizedPhone}`,
        body: `Hi ${name} 👋 Welcome to Robin — you're in!\n\nSign in here: ${process.env.PUBLIC_APP_URL || 'https://robin-agent.onrender.com'}/frontend/robin_site.html\n\nRequest ID: ${requestId}`
      })
    } catch (e) {
      console.warn('[signup] WhatsApp notify failed:', (e as Error).message)
    }

    res.json({ request_id: requestId, submitted, name })
  } catch (err) { next(err) }
})

router.post('/waitlist/check', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    if (!phone) return res.status(400).json({ error: 'Phone required' })
    const { db } = await import('../db/client.js')
    const result = await db.query(
      `SELECT request_id, name, submitted_at FROM waitlist WHERE phone=$1 LIMIT 1`,
      [phone]
    )
    if (result.rows.length > 0) {
      const row = result.rows[0]
      return res.json({
        exists: true,
        request_id: row.request_id,
        name: row.name,
        submitted: new Date(row.submitted_at).toLocaleDateString('en-GB', { day:'numeric', month:'long', year:'numeric' })
      })
    }
    res.json({ exists: false })
  } catch (err) { next(err) }
})

router.post('/auth/send-code', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    if (!phone) return res.status(400).json({ error: 'Phone required' })

    const { db } = await import('../db/client.js')

    // Only accepted users can sign in
    const check = await db.query(
      `SELECT name FROM waitlist WHERE phone=$1 AND status='accepted' LIMIT 1`,
      [phone]
    )
    if (check.rows.length === 0) {
      return res.status(403).json({ error: 'not_accepted', message: "You don't have access yet." })
    }

    const code = String(Math.floor(100000 + Math.random() * 900000))
    await db.query(`DELETE FROM auth_codes WHERE phone=$1`, [phone])
    await db.query(`INSERT INTO auth_codes (phone, code) VALUES ($1, $2)`, [phone, code])

    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_FROM) {
      console.warn(`[auth] Twilio WhatsApp is not configured. Code for ${phone}: ${code}`)
      return res.status(503).json({
        error: 'code_delivery_not_configured',
        message: 'Code delivery is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_FROM.',
        ...(process.env.NODE_ENV !== 'production' ? { debug_code: code } : {})
      })
    }

    try {
      const twilio = (await import('twilio')).default
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      await client.messages.create({
        from: process.env.TWILIO_WHATSAPP_FROM,
        to:   `whatsapp:${phone}`,
        body: `Your Robin sign-in code is: *${code}*\n\nExpires in 10 minutes. Do not share this code.`
      })
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown Twilio error'
      console.warn(`[auth] Code delivery failed for ${phone}: ${message}`)
      return res.status(502).json({
        error: 'code_delivery_failed',
        message: `Could not send your code over WhatsApp: ${message}`,
        ...(process.env.NODE_ENV !== 'production' ? { debug_code: code } : {})
      })
    }

    res.json({ ok: true, delivery: 'whatsapp' })
  } catch (err) { next(err) }
})

router.post('/auth/verify-code', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    const { code } = req.body
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' })

    const { db } = await import('../db/client.js')
    const result = await db.query(
      `SELECT id FROM auth_codes
       WHERE phone=$1 AND code=$2 AND used=false AND expires_at > now()
       LIMIT 1`,
      [phone, code]
    )
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'invalid_or_expired_code', message: 'Invalid or expired code' })
    }

    await db.query(`UPDATE auth_codes SET used=true WHERE id=$1`, [result.rows[0].id])

    const user = await db.query(
      `SELECT name, role FROM waitlist WHERE phone=$1 LIMIT 1`, [phone]
    )
    const name = user.rows[0]?.name || ''
    const role = user.rows[0]?.role || ''
    const token = createSessionToken(phone)

    res.json({ ok: true, token, expires_in: Math.floor(SESSION_TTL_MS / 1000), name, role })
  } catch (err) { next(err) }
})

router.post('/auth/logout', async (_req, res) => {
  res.json({ ok: true })
})

// ── ADMIN ROUTES ──────────────────────────────────────────
router.get('/admin/waitlist', async (req, res, next) => {
  try {
    const { db } = await import('../db/client.js')
    const { rows } = await db.query(
      `SELECT request_id, name, phone, role, note, status, submitted_at
       FROM waitlist ORDER BY submitted_at DESC`
    )
    res.json({ rows })
  } catch (err) { next(err) }
})

router.post('/admin/waitlist/update', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    const { status } = req.body
    if (!phone || !status) return res.status(400).json({ error: 'Missing fields' })
    const { db } = await import('../db/client.js')
    await db.query(`UPDATE waitlist SET status=$1 WHERE phone=$2`, [status, phone])

    // If accepting, notify user via WhatsApp
    if (status === 'accepted') {
      const user = await db.query(`SELECT name FROM waitlist WHERE phone=$1`, [phone])
      const name = user.rows[0]?.name || 'there'
      try {
        const twilio = (await import('twilio')).default
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
        await client.messages.create({
          from: process.env.TWILIO_WHATSAPP_FROM,
          to:   `whatsapp:${phone}`,
          body: `Hi ${name} 👋 You're in.\n\nRobin is ready for you. Sign in here:\nhttps://robin-agent.onrender.com/frontend/robin_site.html\n\nReply to this message anytime to talk to Robin directly.`
        })
      } catch(e) {
        console.warn('[admin] WhatsApp notify failed:', (e as Error).message)
      }
    }
    res.json({ ok: true })
  } catch (err) { next(err) }
})

router.post('/admin/waitlist/notify', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    const { name } = req.body
    const twilio = (await import('twilio')).default
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to:   `whatsapp:${phone}`,
      body: `Hi ${name} 👋 You're in.\n\nRobin is ready for you. Sign in here:\nhttps://robin-agent.onrender.com/frontend/robin_site.html`
    })
    res.json({ ok: true })
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
