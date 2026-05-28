import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../db/pool.js'
import { encryptToken } from '../lib/encrypt.js'
import { getBotInfo, registerWebhook } from '../lib/telegram.js'

const router = Router()

function isAuthorized(req: any) {
  const secret = process.env.ADMIN_SECRET || 'fen-admin-2026'
  const pw = req.headers['x-admin-secret'] || req.query.secret
  return pw === secret
}

function appBaseUrl(req: any) {
  return process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`
}

function makeMagicToken(email: string): string {
  const authSecret = (process.env.FEN_AUTH_SECRET ?? process.env.ROBIN_AUTH_SECRET ?? process.env.SESSION_SECRET) || 'dev-fen-auth-secret'
  const MAGIC_TTL_MS = 1000 * 60 * 15
  const identity = `email:${email}`
  const payload = Buffer.from(JSON.stringify({ phone: identity, type: 'magic', exp: Date.now() + MAGIC_TTL_MS })).toString('base64url')
  const sig = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url')
  return `rt_${payload}.${sig}`
}

async function sendProvisionEmail(email: string, name: string, magicUrl: string): Promise<boolean> {
  if (!process.env.RESEND_API_KEY) return false
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: process.env.AUTH_EMAIL_FROM || 'FEN <onboarding@resend.dev>',
      to: email,
      subject: 'Your FEN workspace is ready',
      text: `Hey ${name || 'there'},\n\nYour FEN workspace has been set up and is ready to use.\n\nSign in here:\n${magicUrl}\n\nThis link expires in 15 minutes. You can always request a new sign-in link from the sign-in page.\n\n— The FEN team`,
    }),
  })
  return res.ok
}

// POST /admin/provision
// Creates a fully provisioned client: tenant + worker + user + membership + waitlist + Stripe customer
// Returns magic sign-in URL (and emails it if RESEND_API_KEY is set)
router.post('/admin/provision', async (req, res, next) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  try {
    const name          = String(req.body.name          || '').trim()
    const email         = String(req.body.email         || '').trim().toLowerCase()
    const plan          = String(req.body.plan          || 'starter')
    const type          = (['client', 'builder', 'agency'].includes(req.body.type) ? req.body.type : 'client') as string
    const telegramToken = String(req.body.telegram_bot_token || '').trim()

    if (!name || !email) return res.status(400).json({ error: 'name and email required' })

    // Stripe customer (non-fatal)
    let stripeCustomerId: string | null = null
    if (process.env.STRIPE_SECRET_KEY) {
      try {
        const Stripe = (await import('stripe')).default
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
        const customer = await stripe.customers.create({
          name,
          email,
          metadata: { provisioned_by: 'fen-admin', plan },
        })
        stripeCustomerId = customer.id
      } catch (e) {
        console.warn('[provision] Stripe customer creation failed:', e instanceof Error ? e.message : e)
      }
    }

    // Create tenant
    const tenantRes = await pool.query(
      `INSERT INTO tenants (name, type, plan, email, stripe_customer_id, provisioned_at)
       VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
      [name, type, plan, email, stripeCustomerId]
    )
    const tenantId: string = tenantRes.rows[0].id

    // Create default live worker
    const workerRes = await pool.query(
      `INSERT INTO workers (tenant_id, name, manifest, status)
       VALUES ($1, $2, $3, 'live') RETURNING id`,
      [
        tenantId,
        `${name} — AI Assistant`,
        JSON.stringify({
          name: `${name} — AI Assistant`,
          description: 'AI assistant for managing leads, tasks, and communications',
          capabilities: ['messaging', 'tasks', 'reminders'],
          timezone: 'Europe/London',
          language: 'en',
          created_at: new Date().toISOString(),
        }),
      ]
    )
    const workerId: string = workerRes.rows[0].id

    // Create Telegram channel if token provided
    let telegramChannel: { channel_id: string; bot_username: string } | null = null
    if (telegramToken) {
      try {
        const botInfo        = await getBotInfo(telegramToken)
        const webhookSecret  = crypto.randomBytes(32).toString('hex')
        const channelRes     = await pool.query(`
          INSERT INTO worker_channels
            (tenant_id, worker_id, channel_type, external_id, display_name, encrypted_config, public_config)
          VALUES ($1, $2, 'telegram', $3, $4, $5, $6)
          RETURNING id
        `, [
          tenantId, workerId, String(botInfo.id), `@${botInfo.username}`,
          JSON.stringify({ bot_token: encryptToken(telegramToken), webhook_secret: encryptToken(webhookSecret) }),
          JSON.stringify({ bot_username: botInfo.username, mode: 'dedicated_bot' }),
        ])
        const channelId = channelRes.rows[0].id as string
        const base      = appBaseUrl(req)
        await registerWebhook(telegramToken, `${base}/webhooks/telegram/${channelId}/${webhookSecret}`, webhookSecret)
        telegramChannel = { channel_id: channelId, bot_username: botInfo.username }
      } catch (e) {
        console.warn('[provision] Telegram channel setup failed:', e instanceof Error ? e.message : e)
      }
    }

    // Find or create user
    const userRes = await pool.query(
      `INSERT INTO users (email) VALUES ($1)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [email]
    )
    const userId: string = userRes.rows[0].id

    // Create owner membership
    await pool.query(
      `INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, 'owner')
       ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'owner'`,
      [userId, tenantId]
    )

    // Upsert waitlist as accepted owner (enables magic link login)
    const requestId = 'P-' + Date.now().toString(36).toUpperCase().slice(-6)
    const existingWL = await pool.query(`SELECT id FROM waitlist WHERE LOWER(email)=$1 LIMIT 1`, [email])
    if (existingWL.rows.length) {
      await pool.query(
        `UPDATE waitlist SET status = 'accepted', role = 'owner', name = $1 WHERE LOWER(email) = $2`,
        [name, email]
      )
    } else {
      await pool.query(
        `INSERT INTO waitlist (request_id, name, email, status, role) VALUES ($1, $2, $3, 'accepted', 'owner')`,
        [requestId, name, email]
      )
    }

    // Record audit event
    try {
      await pool.query(
        `INSERT INTO audit_log (tenant_id, actor, action, target, metadata)
         VALUES ($1, 'admin', 'provision', $2, $3)`,
        [tenantId, email, JSON.stringify({ plan, type, stripe_customer_id: stripeCustomerId })]
      )
    } catch { /* non-fatal */ }

    // Generate magic sign-in link and send welcome email
    const magicToken = makeMagicToken(email)
    const magicUrl = `${appBaseUrl(req)}/auth/magic?token=${encodeURIComponent(magicToken)}`
    let emailSent = false
    try {
      emailSent = await sendProvisionEmail(email, name, magicUrl)
    } catch (e) {
      console.warn('[provision] email failed:', e instanceof Error ? e.message : e)
    }

    res.json({
      ok: true,
      tenant_id: tenantId,
      worker_id: workerId,
      user_id: userId,
      stripe_customer_id: stripeCustomerId,
      magic_url: magicUrl,
      email_sent: emailSent,
      telegram_channel: telegramChannel,
    })
  } catch (err) { next(err) }
})

// GET /admin/clients — list all provisioned tenants with subscription status
router.get('/admin/clients', async (req, res, next) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  try {
    const result = await pool.query(`
      SELECT
        t.id,
        t.name,
        t.email,
        t.type,
        t.plan,
        t.stripe_customer_id,
        t.provisioned_at,
        s.status  AS sub_status,
        s.stripe_subscription_id,
        COUNT(w.id)::int AS worker_count
      FROM tenants t
      LEFT JOIN subscriptions s ON s.tenant_id = t.id
      LEFT JOIN workers w ON w.tenant_id = t.id
      GROUP BY t.id, t.name, t.email, t.type, t.plan, t.stripe_customer_id, t.provisioned_at,
               s.status, s.stripe_subscription_id
      ORDER BY t.provisioned_at DESC
    `)
    res.json({ ok: true, clients: result.rows })
  } catch (err) { next(err) }
})

// POST /admin/clients/:tenantId/checkout
// Kick off a Stripe checkout for an existing tenant
router.post('/admin/clients/:tenantId/checkout', async (req, res, next) => {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'unauthorized' })
  try {
    const { tenantId } = req.params
    if (!process.env.STRIPE_SECRET_KEY) return res.status(502).json({ error: 'Stripe not configured' })

    const tenantRow = await pool.query(`SELECT name, email, stripe_customer_id FROM tenants WHERE id=$1`, [tenantId])
    if (!tenantRow.rows.length) return res.status(404).json({ error: 'tenant_not_found' })

    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

    const priceId = process.env.STRIPE_STARTER_PRICE_ID
    if (!priceId) return res.status(502).json({ error: 'STRIPE_STARTER_PRICE_ID not set' })

    const base = appBaseUrl(req)
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: tenantRow.rows[0].stripe_customer_id || undefined,
      customer_email: tenantRow.rows[0].stripe_customer_id ? undefined : tenantRow.rows[0].email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${base}/frontend/fen_dashboard.html?billing=success`,
      cancel_url: `${base}/frontend/fen_dashboard.html?billing=cancel`,
      metadata: { tenant_id: tenantId },
    })

    res.json({ ok: true, url: session.url })
  } catch (err) { next(err) }
})

export default router
