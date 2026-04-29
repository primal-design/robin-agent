import { Router } from 'express'
import crypto from 'crypto'

const router = Router()
const ACCESS_TTL_MS = 1000 * 60 * 60 * 24 * 7
const REFRESH_TTL_MS = 1000 * 60 * 60 * 24 * 30
const MAGIC_TTL_MS = 1000 * 60 * 10

function normalizePhone(phone: string) {
  const raw = String(phone || '').trim()
  if (!raw) return ''
  return raw.startsWith('+') ? raw : `+${raw.replace(/[^0-9]/g, '')}`
}

function normalizeEmail(email: string) {
  return String(email || '').trim().toLowerCase()
}

function authSecret() {
  return process.env.ROBIN_AUTH_SECRET || process.env.SESSION_SECRET || process.env.TWILIO_AUTH_TOKEN || 'dev-robin-auth-secret'
}

function signPayload(payload: string) {
  return crypto.createHmac('sha256', authSecret()).update(payload).digest('base64url')
}

function createToken(phone: string, type: 'access' | 'refresh' | 'magic', ttlMs: number) {
  const payload = Buffer.from(JSON.stringify({ phone, type, exp: Date.now() + ttlMs })).toString('base64url')
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
    return { phone: normalizePhone(data.phone), type: data.type }
  } catch { return null }
}

function createSession(phone: string) {
  return {
    token: createToken(phone, 'access', ACCESS_TTL_MS),
    refresh_token: createToken(phone, 'refresh', REFRESH_TTL_MS),
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_expires_in: Math.floor(REFRESH_TTL_MS / 1000)
  }
}

function appBaseUrl(req: any) {
  return process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`
}

async function sendWhatsAppCode(phone: string, code: string) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_FROM) throw new Error('Twilio WhatsApp is not configured')
  const twilio = (await import('twilio')).default
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  await client.messages.create({ from: process.env.TWILIO_WHATSAPP_FROM, to: `whatsapp:${phone}`, body: `Your Robin sign-in code is: ${code}. Expires in 10 minutes.` })
}

async function sendSMSCode(phone: string, code: string) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_SMS_FROM) throw new Error('Twilio SMS is not configured')
  const twilio = (await import('twilio')).default
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
  await client.messages.create({ from: process.env.TWILIO_SMS_FROM, to: phone, body: `Your Robin sign-in code is: ${code}. Expires in 10 minutes.` })
}

async function sendTelegramCode(phone: string, code: string) {
  // Telegram requires a chat_id — we look it up from a stored mapping or inform the user to message the bot first
  const chatId = process.env[`TELEGRAM_CHAT_${phone.replace(/[^0-9]/g, '')}`]
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) throw new Error('Telegram not set up for this number. Message @RobinAssistantBot on Telegram first.')
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: `Your Robin sign-in code is: ${code}. Expires in 10 minutes.` })
  })
  if (!res.ok) throw new Error(`Telegram delivery failed: ${res.status}`)
}

async function sendEmail(email: string, subject: string, text: string) {
  if (!process.env.RESEND_API_KEY) throw new Error('Email is not configured. Set RESEND_API_KEY and AUTH_EMAIL_FROM.')
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: process.env.AUTH_EMAIL_FROM || 'Robin <no-reply@robin-agent.app>', to: email, subject, text })
  })
  if (!response.ok) throw new Error(`Email provider failed with ${response.status}`)
}

async function sendEmailCode(email: string, code: string) {
  await sendEmail(email, 'Your Robin sign-in code', `Your Robin sign-in code is ${code}. It expires in 10 minutes.`)
}

async function acceptedUser(db: any, phone: string) {
  return db.query(`SELECT name, role, email FROM waitlist WHERE phone=$1 AND status='accepted' LIMIT 1`, [phone])
}

router.post('/auth/send-code', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    const requestedEmail = normalizeEmail(req.body.email)
    if (!phone) return res.status(400).json({ error: 'phone_required', message: 'Phone required' })
    const { db } = await import('../db/client.js')
    const check = await acceptedUser(db, phone)
    if (check.rows.length === 0) return res.status(403).json({ error: 'not_accepted', message: "You don't have access yet." })

    const email = requestedEmail || normalizeEmail(check.rows[0]?.email)
    if (requestedEmail && requestedEmail !== normalizeEmail(check.rows[0]?.email)) await db.query(`UPDATE waitlist SET email=$1 WHERE phone=$2`, [requestedEmail, phone])

    const code = String(Math.floor(100000 + Math.random() * 900000))
    await db.query(`DELETE FROM auth_codes WHERE phone=$1`, [phone])
    await db.query(`INSERT INTO auth_codes (phone, code) VALUES ($1, $2)`, [phone, code])

    const channel: string = req.body.channel || 'whatsapp'
    const failures: string[] = []

    // Try requested channel first
    if (channel === 'sms') {
      try { await sendSMSCode(phone, code); return res.json({ ok: true, delivery: 'sms' }) } catch (e) { failures.push(`sms: ${e instanceof Error ? e.message : String(e)}`) }
    } else if (channel === 'telegram') {
      try { await sendTelegramCode(phone, code); return res.json({ ok: true, delivery: 'telegram' }) } catch (e) { failures.push(`telegram: ${e instanceof Error ? e.message : String(e)}`) }
    } else if (channel === 'email') {
      if (email) {
        try { await sendEmailCode(email, code); return res.json({ ok: true, delivery: 'email', email }) } catch (e) { failures.push(`email: ${e instanceof Error ? e.message : String(e)}`) }
      } else {
        return res.status(400).json({ error: 'email_required', message: 'No email on file. Add your email to use this option.' })
      }
    } else {
      // Default: WhatsApp, fall back to SMS, then email
      try { await sendWhatsAppCode(phone, code); return res.json({ ok: true, delivery: 'whatsapp' }) } catch (e) { failures.push(`whatsapp: ${e instanceof Error ? e.message : String(e)}`) }
      try { await sendSMSCode(phone, code); return res.json({ ok: true, delivery: 'sms' }) } catch (e) { failures.push(`sms: ${e instanceof Error ? e.message : String(e)}`) }
      if (email) {
        try { await sendEmailCode(email, code); return res.json({ ok: true, delivery: 'email', email }) } catch (e) { failures.push(`email: ${e instanceof Error ? e.message : String(e)}`) }
      }
    }

    console.warn(`[auth] OTP delivery failed for ${phone}. Code: ${code}. ${failures.join(' | ')}`)
    return res.status(502).json({ error: 'code_delivery_failed', message: 'Could not send your code. Try a different channel.', failures, ...(process.env.NODE_ENV !== 'production' ? { debug_code: code } : {}) })
  } catch (err) { next(err) }
})

router.post('/auth/send-magic-link', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    const requestedEmail = normalizeEmail(req.body.email)
    if (!phone) return res.status(400).json({ error: 'phone_required', message: 'Phone required' })
    const { db } = await import('../db/client.js')
    const check = await acceptedUser(db, phone)
    if (check.rows.length === 0) return res.status(403).json({ error: 'not_accepted', message: "You don't have access yet." })
    const email = requestedEmail || normalizeEmail(check.rows[0]?.email)
    if (!email) return res.status(400).json({ error: 'email_required', message: 'Add an email address to receive a magic link.' })
    if (requestedEmail && requestedEmail !== normalizeEmail(check.rows[0]?.email)) await db.query(`UPDATE waitlist SET email=$1 WHERE phone=$2`, [requestedEmail, phone])
    const magic = createToken(phone, 'magic', MAGIC_TTL_MS)
    const url = `${appBaseUrl(req)}/auth/magic?token=${encodeURIComponent(magic)}`
    await sendEmail(email, 'Sign in to Robin', `Tap this link to sign in to Robin. It expires in 10 minutes.\n\n${url}`)
    res.json({ ok: true, delivery: 'email', email })
  } catch (err) { next(err) }
})

router.get('/auth/magic', async (req, res) => {
  const session = readToken(String(req.query.token || ''), 'magic')
  if (!session?.phone) return res.status(401).send('Magic link expired or invalid. Please request a new one.')
  const nextUrl = `/frontend/robin_dashboard.html?token=${encodeURIComponent(createSession(session.phone).token)}&refresh=${encodeURIComponent(createSession(session.phone).refresh_token)}`
  res.redirect(nextUrl)
})

router.post('/auth/verify-code', async (req, res, next) => {
  try {
    const phone = normalizePhone(req.body.phone)
    const code = String(req.body.code || '').trim()
    if (!phone || !code) return res.status(400).json({ error: 'missing_fields', message: 'Phone and code required' })
    const { db } = await import('../db/client.js')
    const result = await db.query(`SELECT id FROM auth_codes WHERE phone=$1 AND code=$2 AND used=false AND expires_at > now() LIMIT 1`, [phone, code])
    if (result.rows.length === 0) return res.status(401).json({ error: 'invalid_or_expired_code', message: 'Invalid or expired code' })
    await db.query(`UPDATE auth_codes SET used=true WHERE id=$1`, [result.rows[0].id])
    const user = await db.query(`SELECT name, role FROM waitlist WHERE phone=$1 LIMIT 1`, [phone])
    res.json({ ok: true, ...createSession(phone), name: user.rows[0]?.name || '', role: user.rows[0]?.role || '' })
  } catch (err) { next(err) }
})

router.post('/auth/refresh', async (req, res) => {
  const token = String(req.body.refresh_token || '').trim()
  const session = readToken(token, 'refresh')
  if (!session?.phone) return res.status(401).json({ error: 'invalid_refresh', message: 'Please sign in again.' })
  res.json({ ok: true, ...createSession(session.phone) })
})

// ── Google OAuth ─────────────────────────────────────────────────────────────
function googleRedirectUri(req: any) {
  // Always use PUBLIC_APP_URL if set, otherwise fall back to request — but force https on Render
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
  if (!code) return res.redirect('/frontend/robin_site.html?error=google_denied')

  const clientId     = process.env.GOOGLE_CLIENT_ID     || ''
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || ''

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     clientId,
        client_secret: clientSecret,
        redirect_uri:  googleRedirectUri(req),
        grant_type:    'authorization_code',
      })
    })
    const tokenData = await tokenRes.json() as any
    if (!tokenData.id_token) return res.redirect('/frontend/robin_site.html?error=google_token_failed')

    // Decode id_token (JWT — no verify needed for our purposes, Google already validated)
    const payload = JSON.parse(Buffer.from(tokenData.id_token.split('.')[1], 'base64url').toString())
    const email   = String(payload.email || '').toLowerCase().trim()
    const name    = String(payload.name  || payload.given_name || '').trim()
    if (!email) return res.redirect('/frontend/robin_site.html?error=google_no_email')

    const { db } = await import('../db/client.js')

    // Look up user by email in waitlist
    const check = await db.query(`SELECT phone, name, role, status FROM waitlist WHERE LOWER(email)=$1 LIMIT 1`, [email])

    if (!check.rows.length || check.rows[0].status !== 'accepted') {
      // Not accepted yet — redirect to request access with email pre-filled
      return res.redirect(`/frontend/robin_site.html?error=not_accepted&email=${encodeURIComponent(email)}`)
    }

    const user  = check.rows[0]
    // Use phone as identity (existing token system); fall back to email hash if no phone
    const phone = user.phone || `email:${email}`

    // Update name from Google if not set
    if (!user.name && name) await db.query(`UPDATE waitlist SET name=$1 WHERE LOWER(email)=$2`, [name, email])

    const session = createSession(phone)
    const nextUrl = `/frontend/robin_dashboard.html?token=${encodeURIComponent(session.token)}&refresh=${encodeURIComponent(session.refresh_token)}&name=${encodeURIComponent(user.name || name)}`
    res.redirect(nextUrl)
  } catch (err) {
    console.error('[google-auth]', err)
    res.redirect('/frontend/robin_site.html?error=google_failed')
  }
})

router.post('/auth/dev-login', async (req, res, next) => {
  try {
    if (process.env.NODE_ENV === 'production' || process.env.DEV_LOGIN_BYPASS !== 'true') return res.status(404).json({ error: 'not_found' })
    const phone = normalizePhone(req.body.phone)
    if (!phone) return res.status(400).json({ error: 'phone_required', message: 'Phone required' })
    const { findOrCreateUser, db } = await import('../db/client.js')
    await findOrCreateUser(phone)
    await db.query(`INSERT INTO waitlist (request_id, name, phone, email, status) VALUES ($1,$2,$3,$4,'accepted') ON CONFLICT (phone) DO UPDATE SET status='accepted', email=COALESCE(EXCLUDED.email, waitlist.email)`, [`DEV-${Date.now().toString(36)}`, req.body.name || 'Dev User', phone, normalizeEmail(req.body.email) || null])
    res.json({ ok: true, ...createSession(phone), name: req.body.name || 'Dev User', role: 'dev' })
  } catch (err) { next(err) }
})

router.post('/auth/logout', async (_req, res) => res.json({ ok: true }))

export default router
