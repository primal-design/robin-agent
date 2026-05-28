import { Router } from 'express'

const router = Router()

function isAuthorized(req: any) {
  const secret = process.env.ADMIN_SECRET || 'fen-admin-2026'
  const pw = req.headers['x-admin-secret'] || req.query.secret
  return pw === secret
}

router.post('/admin/auth', (req, res) => {
  const secret = process.env.ADMIN_SECRET || 'fen-admin-2026'
  if (req.body.password === secret) return res.json({ ok: true })
  return res.status(401).json({ ok: false, error: 'wrong_password' })
})

router.get('/admin/waitlist', async (req, res, next) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  try {
    const { db } = await import('../db/client.js')
    const result = await db.query(`
      SELECT request_id, name, email, role, status,
             COALESCE(submitted_at, created_at) AS submitted_at
      FROM waitlist
      ORDER BY COALESCE(submitted_at, created_at) DESC
    `)
    res.json({ ok: true, rows: result.rows })
  } catch (err) { next(err) }
})

router.post('/admin/waitlist/update', async (req, res, next) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  try {
    const { email, status } = req.body
    if (!email || !['accepted', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'invalid_params' })
    }
    const { db } = await import('../db/client.js')
    await db.query(`UPDATE waitlist SET status=$1 WHERE LOWER(email)=$2`, [status, email.toLowerCase()])

    if (status === 'accepted') {
      try {
        const row = await db.query(`SELECT name, email FROM waitlist WHERE LOWER(email)=$1 LIMIT 1`, [email.toLowerCase()])
        const name  = row.rows[0]?.name  || 'there'
        const email2 = row.rows[0]?.email || ''
        if (email2 && process.env.RESEND_API_KEY) {
          const appUrl = process.env.PUBLIC_APP_URL || 'https://fen-agent.onrender.com'
          await fetch('https://api.resend.com/emails', {
            method:  'POST',
            headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from:    process.env.AUTH_EMAIL_FROM || 'FEN <onboarding@resend.dev>',
              to:      email2,
              subject: "You're in — FEN is ready for you",
              text:    `Hey ${name}!\n\nYou've been accepted into FEN. Sign in here:\n${appUrl}/frontend/fen_site.html\n\n— The FEN team`,
            }),
          })
        }
      } catch (e) {
        console.warn('[admin] email notify failed:', e instanceof Error ? e.message : e)
      }
    }

    res.json({ ok: true })
  } catch (err) { next(err) }
})

router.post('/admin/waitlist/notify', async (req, res, next) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  try {
    const { name, email } = req.body
    if (!email) return res.status(400).json({ error: 'email_required' })
    if (!process.env.RESEND_API_KEY) return res.status(502).json({ error: 'email_not_configured' })
    const appUrl = process.env.PUBLIC_APP_URL || 'https://fen-agent.onrender.com'
    await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from:    process.env.AUTH_EMAIL_FROM || 'FEN <onboarding@resend.dev>',
        to:      email,
        subject: "You're in — FEN is ready for you",
        text:    `Hey ${name || 'there'}!\n\nYour FEN access is ready. Sign in here:\n${appUrl}/frontend/fen_site.html\n\n— The FEN team`,
      }),
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
