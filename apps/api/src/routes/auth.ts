import { Router } from 'express'
import crypto from 'crypto'

const router = Router()
const ACCESS_TTL_MS = 1000 * 60 * 60 * 24 * 7
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 30
const MAGIC_TTL_MS = 1000 * 60 * 15

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase()
}

function authSecret() {
  return process.env.ROBIN_AUTH_SECRET || process.env.SESSION_SECRET || process.env.TWILIO_AUTH_TOKEN || 'dev-fen-auth-secret'
}

function signPayload(payload: string) {
  return crypto.createHmac('sha256', authSecret()).update(payload).digest('base64url')
}

// identity = "email:user@example.com" or a phone number string
function createToken(identity: string, type: 'access' | 'refresh' | 'magic', ttlMs: number) {
  const payload = Buffer.from(JSON.stringify({ phone: identity, type, exp: Date.now() + ttlMs })).toString('base64url')
  return `rt_${payload}.${signPayload(payload)}`
}

function readToken(token: string, expectedType?: 'access' | 'refresh' | 'magic') {
  const raw = String(token || '').trim()
  if (!raw.startsWith('rt_')) return null
  const [payload, sig] = raw.slice(3).split('.')
  if (!payload || !sig || signPayload(payload) !== sig) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (expectedType && data.type !== expectedType) return null
    if (Number(data.exp || 0) <= Date.now()) return null
    return { phone: String(data.phone || '') }
  } catch { return null }
}

function createSession(identity: string) {
  return {
    token: createToken(identity, 'access', ACCESS_TTL_MS),
    refresh_token: createToken(identity, 'refresh', REFRESH_TTL_MS),
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_expires_in: Math.floor(REFRESH_TTL_MS / 1000)
  }
}

function appBaseUrl(req: any) {
  return process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`
}

async function sendEmail(email: string, subject: string, text: string) {
  if (!process.env.RESEND_API_KEY) throw new Error('Email not configured. Set RESEND_API_KEY.')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM || 'FEN <onboarding@resend.dev>',
      to: email,
      subject,
      text,
    })
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Email provider failed ${response.status}: ${body.slice(0, 120)}`)
  }
}

// ── Magic link (primary sign-in method) ──────────────────────────────────────

router.post('/auth/send-magic-link', async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body.email)
    if (!email) return res.status(400).json({ error: 'email_required', message: 'Email address required.' })

    const { db } = await import('../db/client.js')
    const check = await db.query(
      `SELECT name, status FROM waitlist WHERE LOWER(email)=$1 LIMIT 1`,
      [email]
    )

    if (!check.rows.length || check.rows[0].status !== 'accepted') {
      return res.status(403).json({ error: 'not_accepted', message: "That email doesn't have access yet." })
    }

    const name = check.rows[0].name || ''
    const identity = `email:${email}`
    const magic = createToken(identity, 'magic', MAGIC_TTL_MS)
    const url = `${appBaseUrl(req)}/auth/magic?token=${encodeURIComponent(magic)}`

    await sendEmail(
      email,
      'Sign in to FEN',
      `Hey ${name || 'there'},\n\nClick this link to sign in to FEN. It expires in 15 minutes.\n\n${url}\n\n— The FEN team`
    )

    res.json({ ok: true, delivery: 'email', email })
  } catch (err) { next(err) }
})

// ── Magic link redirect ───────────────────────────────────────────────────────

router.get('/auth/magic', async (req, res) => {
  const session = readToken(String(req.query.token || ''), 'magic')
  if (!session?.phone) {
    return res.status(401).send('This link has expired or is invalid. Please request a new one.')
  }

  let name = ''
  try {
    const { db } = await import('../db/client.js')
    if (session.phone.startsWith('email:')) {
      const email = session.phone.slice(6)
      const r = await db.query(`SELECT name FROM waitlist WHERE LOWER(email)=$1 LIMIT 1`, [email])
      name = r.rows[0]?.name || ''
    } else {
      const r = await db.query(`SELECT name FROM waitlist WHERE phone=$1 LIMIT 1`, [session.phone])
      name = r.rows[0]?.name || ''
    }
  } catch { /* non-fatal */ }

  const s = createSession(session.phone)
  res.redirect(
    `/frontend/fen_dashboard.html?token=${encodeURIComponent(s.token)}&refresh=${encodeURIComponent(s.refresh_token)}&name=${encodeURIComponent(name)}`
  )
})

// ── Token refresh ─────────────────────────────────────────────────────────────

router.post('/auth/refresh', async (req, res) => {
  const token = String(req.body.refresh_token || '').trim()
  const session = readToken(token, 'refresh')
  if (!session?.phone) return res.status(401).json({ error: 'invalid_refresh', message: 'Please sign in again.' })
  res.json({ ok: true, ...createSession(session.phone) })
})

router.post('/auth/logout', async (_req, res) => res.json({ ok: true }))

// ── Google OAuth ─────────────────────────────────────────────────────────────

router.get('/auth/google/check', (req, res) => {
  res.json({
    client_id_set:     !!process.env.GOOGLE_CLIENT_ID,
    client_secret_set: !!process.env.GOOGLE_CLIENT_SECRET,
    redirect_uri:      `${process.env.PUBLIC_APP_URL || `https://${req.get('host')}`}/auth/google/callback`,
    public_app_url:    process.env.PUBLIC_APP_URL || '(not set)',
    host_header:       req.get('host'),
  })
})

function googleRedirectUri(req: any) {
  const base = process.env.PUBLIC_APP_URL || `https://${req.get('host')}`
  return `${base}/auth/google/callback`
}

router.get('/auth/google', (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID
  if (!clientId) return res.status(500).send('Google OAuth not configured.')
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  googleRedirectUri(req),
    response_type: 'code',
    scope:         'openid email profile',
    access_type:   'offline',
    prompt:        'select_account',
  })
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
})

router.get('/auth/google/callback', async (req, res) => {
  const code = String(req.query.code || '')
  if (!code) return res.redirect('/frontend/fen_site.html?error=google_denied')

  const clientId     = process.env.GOOGLE_CLIENT_ID     || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''

  try {
    const redirectUri = googleRedirectUri(req)
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' })
    })
    const rawBody = await tokenRes.text()
    let tokenData: any
    try { tokenData = JSON.parse(rawBody) } catch {
      return res.redirect('/frontend/fen_site.html?error=google_token_failed')
    }
    if (tokenData.error || !tokenData.id_token) {
      return res.redirect('/frontend/fen_site.html?error=google_token_failed')
    }

    const payload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64url').toString())
    const email   = String(payload.email || '').toLowerCase().trim()
    const name    = String(payload.name  || payload.given_name || '').trim()
    if (!email) return res.redirect('/frontend/fen_site.html?error=google_no_email')

    const { db } = await import('../db/client.js')
    const check = await db.query(`SELECT name, status FROM waitlist WHERE LOWER(email)=$1 LIMIT 1`, [email])

    if (!check.rows.length || check.rows[0].status !== 'accepted') {
      return res.redirect(`/frontend/fen_site.html?error=not_accepted&email=${encodeURIComponent(email)}`)
    }

    if (!check.rows[0].name && name) {
      await db.query(`UPDATE waitlist SET name=$1 WHERE LOWER(email)=$2`, [name, email])
    }

    const identity = `email:${email}`
    const s = createSession(identity)
    res.redirect(
      `/frontend/fen_dashboard.html?token=${encodeURIComponent(s.token)}&refresh=${encodeURIComponent(s.refresh_token)}&name=${encodeURIComponent(check.rows[0].name || name)}`
    )
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[google-auth] unhandled:', msg)
    res.redirect(`/frontend/fen_site.html?error=google_failed&detail=${encodeURIComponent(msg.slice(0, 120))}`)
  }
})

// ── Dev login (non-production only) ──────────────────────────────────────────

router.post('/auth/dev-login', async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' || process.env.DEV_LOGIN_BYPASS !== 'true') {
      return res.status(404).json({ error: 'not_found' })
    }
    const email = normalizeEmail(req.body.email)
    if (!email) return res.status(400).json({ error: 'email_required' })
    const { db } = await import('../db/client.js')
    await db.query(
      `INSERT INTO waitlist (request_id, name, email, status, role)
       VALUES ($1,$2,$3,'accepted','owner')
       ON CONFLICT (LOWER(email)) DO UPDATE SET status='accepted'`,
      [`DEV-${Date.now().toString(36)}`, req.body.name || 'Dev User', email]
    )
    const identity = `email:${email}`
    res.json({ ok: true, ...createSession(identity), name: req.body.name || 'Dev User', role: 'owner' })
  } catch (err) { next(err) }
})

export default router
