import { Router } from 'express'
import { getAuthUrl, exchangeCode, getEmailProfile } from '../lib/gmail.js'
import { db } from '../db/client.js'
import { findOrCreateUser } from '../db/client.js'

const router = Router()

// Step 1 — redirect user to Google consent screen
router.get('/email/connect', async (req, res) => {
  const phone = String(req.query.phone || '')
  if (!phone) return res.status(400).send('Phone required')
  const userId = await findOrCreateUser(phone)
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
    res.redirect('/frontend/robin_dashboard.html?gmail=error')
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
