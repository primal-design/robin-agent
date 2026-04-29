import { Router } from 'express'

const router = Router()

// Simple password guard via header or query
function isAuthorized(req: any) {
  const secret = process.env.ADMIN_SECRET || 'robin-admin-2026'
  const pw = req.headers['x-admin-secret'] || req.query.secret
  return pw === secret
}

// Client-side password check hits this lightweight route first
router.post('/admin/auth', (req, res) => {
  const secret = process.env.ADMIN_SECRET || 'robin-admin-2026'
  if (req.body.password === secret) return res.json({ ok: true })
  return res.status(401).json({ ok: false, error: 'wrong_password' })
})

router.get('/admin/waitlist', async (req, res, next) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  try {
    const { db } = await import('../db/client.js')
    const result = await db.query(`
      SELECT request_id, name, phone, email, role, status,
             created_at AS submitted_at
      FROM waitlist
      ORDER BY created_at DESC
    `)
    res.json({ ok: true, rows: result.rows })
  } catch (err) { next(err) }
})

router.post('/admin/waitlist/update', async (req, res, next) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  try {
    const { phone, status } = req.body
    if (!phone || !['accepted', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'invalid_params' })
    }
    const { db } = await import('../db/client.js')
    await db.query(`UPDATE waitlist SET status=$1 WHERE phone=$2`, [status, phone])

    // If accepting, try to notify them via WhatsApp
    if (status === 'accepted') {
      try {
        const row = await db.query(`SELECT name FROM waitlist WHERE phone=$1 LIMIT 1`, [phone])
        const name = row.rows[0]?.name || 'there'
        if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM) {
          const twilio = (await import('twilio')).default
          const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
          const appUrl = process.env.PUBLIC_APP_URL || 'https://robin-agent.onrender.com'
          await client.messages.create({
            from: process.env.TWILIO_WHATSAPP_FROM,
            to: `whatsapp:${phone}`,
            body: `Hey ${name}! 🎉 You're in — Robin is ready for you.\n\nSign in here: ${appUrl}/frontend/robin_site.html`
          })
        }
      } catch (e) {
        console.warn('[admin] WhatsApp notify failed:', e instanceof Error ? e.message : e)
      }
    }

    res.json({ ok: true })
  } catch (err) { next(err) }
})

router.post('/admin/waitlist/notify', async (req, res, next) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  try {
    const { phone, name } = req.body
    if (!phone) return res.status(400).json({ error: 'phone_required' })
    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !process.env.TWILIO_WHATSAPP_FROM) {
      return res.status(502).json({ error: 'twilio_not_configured' })
    }
    const twilio = (await import('twilio')).default
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    const appUrl = process.env.PUBLIC_APP_URL || 'https://robin-agent.onrender.com'
    await client.messages.create({
      from: process.env.TWILIO_WHATSAPP_FROM,
      to: `whatsapp:${phone}`,
      body: `Hey ${name || 'there'}! 🎉 Your Robin access is ready.\n\nSign in here: ${appUrl}/frontend/robin_site.html`
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
