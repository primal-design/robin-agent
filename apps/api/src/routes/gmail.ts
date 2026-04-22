import { Router } from 'express'
import { getAuthUrl, exchangeCode, getEmailProfile } from '../lib/gmail.js'
import { db } from '../db/client.js'
import { findOrCreateUser } from '../db/client.js'

const router = Router()

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function decodePhoneFromSessionId(sessionId: string) {
  const raw = sessionId.trim()
  if (!raw) return ''

  if (raw.startsWith('tok_')) {
    try {
      const decoded = Buffer.from(raw.slice(4), 'base64').toString()
      return decoded.split(':')[0]?.trim() ?? ''
    } catch {
      return ''
    }
  }

  if (raw.startsWith('sid_')) return raw.slice(4).trim()
  if (/^\+?\d[\d\s()-]{6,}$/.test(raw)) return raw
  return ''
}

async function resolveUserId(query: Record<string, unknown>) {
  const phone = String(query.phone || '').trim()
  if (phone) return findOrCreateUser(phone)

  const sessionId = String(query.sessionId || '').trim()
  const phoneFromToken = decodePhoneFromSessionId(sessionId)
  if (phoneFromToken) return findOrCreateUser(phoneFromToken)

  return ''
}

function gmailErrorMessage(err: unknown) {
  const responseData = typeof err === 'object' && err !== null && 'response' in err
    ? (err as { response?: { data?: { error?: string, error_description?: string } } }).response?.data
    : undefined

  const detail = responseData?.error_description || responseData?.error || (err instanceof Error ? err.message : 'Unknown error')
  const full = String(detail || 'Unknown error')

  if (full.includes('invalid_client')) {
    return 'Google rejected the client credentials. Check GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in Render.'
  }
  if (full.includes('redirect_uri_mismatch')) {
    return 'The Google redirect URI does not match. Both Render and Google Console should use https://robin-agent.onrender.com/email/callback.'
  }
  if (full.includes('invalid_grant')) {
    return 'This Google sign-in code is expired or already used. Start the Gmail connect flow again from the dashboard.'
  }

  return full
}

// Step 1 — redirect user to Google consent screen
router.get('/email/connect', async (req, res) => {
  const userId = await resolveUserId(req.query as Record<string, unknown>)
  if (!userId) return res.status(400).send('Phone or sessionId required')
  const url = getAuthUrl(userId)
  res.redirect(url)
})

// Legacy-compatible alias so the dashboard works on either backend generation
router.get('/email/auth', async (req, res) => {
  const userId = await resolveUserId(req.query as Record<string, unknown>)
  if (!userId) return res.status(400).send('Phone or sessionId required')
  const url = getAuthUrl(userId)
  res.redirect(url)
})

// Step 2 — Google redirects back here with code
router.get('/email/callback', async (req, res) => {
  const { code, state: userId } = req.query as { code: string, state: string }
  if (!code || !userId) return res.status(400).send('Missing code or state')

  try {
    const tokens = await exchangeCode(code)
    const profile = await getEmailProfile(tokens)

    await db.query(
      `INSERT INTO gmail_tokens (user_id, access_token, refresh_token, expiry_date, email)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         access_token=$2, refresh_token=COALESCE($3, gmail_tokens.refresh_token),
         expiry_date=$4, email=$5, updated_at=now()`,
      [userId, tokens.access_token, tokens.refresh_token, tokens.expiry_date, profile.email]
    )

    // Redirect to dashboard with success
    res.redirect('/frontend/robin_dashboard.html?gmail=connected')
  } catch (e) {
    console.error('[Gmail callback]', e)
    const message = gmailErrorMessage(e)
    res.status(500).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Gmail connection failed</title>
    <style>
      body { font-family: system-ui, sans-serif; background: #f8f7f4; color: #1a1816; margin: 0; }
      main { max-width: 640px; margin: 64px auto; padding: 32px; background: #fff; border: 1px solid rgba(26,24,22,.08); }
      h1 { margin-top: 0; font-size: 28px; }
      p, code { line-height: 1.6; }
      code { display: block; padding: 12px; background: #f3efe8; white-space: pre-wrap; }
      a { color: #8b6e4a; }
    </style>
  </head>
  <body>
    <main>
      <h1>Gmail connection failed</h1>
      <p>Robin received the Google callback, but the final connection step failed.</p>
      <code>${escapeHtml(message)}</code>
      <p><a href="/frontend/robin_dashboard.html">Return to dashboard</a></p>
    </main>
  </body>
</html>`)
  }
})

// Check connection status
router.get('/email/status', async (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '')
  if (!token) return res.json({ connected: false })
  try {
    const decoded = Buffer.from(token.replace('tok_', ''), 'base64').toString()
    const phone = decoded.split(':')[0]
    const userId = await findOrCreateUser(phone)
    const result = await db.query(`SELECT email FROM gmail_tokens WHERE user_id=$1`, [userId])
    res.json({ connected: result.rows.length > 0, email: result.rows[0]?.email || null })
  } catch {
    res.json({ connected: false })
  }
})

export default router
