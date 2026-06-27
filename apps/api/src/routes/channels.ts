import { Router } from 'express'
import crypto from 'crypto'
import { pool } from '../db/pool.js'
import { withTenant } from '../db/withTenant.js'
import { requireAuth } from '../lib/auth.js'
import { encryptToken, decryptToken } from '../lib/encrypt.js'
import { sendTelegram, registerWebhook, deleteWebhook, getBotInfo } from '../lib/telegram.js'
import { env } from '../config/env.js'

const router = Router()

function channelBase(): string {
  return process.env.PUBLIC_APP_URL || `https://fen-agent.onrender.com`
}

// ── Create Telegram channel for a worker ──────────────────────────────────────

router.post('/channels/telegram', requireAuth, async (req, res, next) => {
  try {
    const { worker_id, bot_token } = req.body as { worker_id: string; bot_token: string }
    if (!worker_id || !bot_token) return res.status(400).json({ error: 'worker_id and bot_token required' })

    // Verify token is valid and get bot username
    let botInfo: { id: number; username: string }
    try {
      botInfo = await getBotInfo(bot_token)
    } catch {
      return res.status(400).json({ error: 'Invalid bot token — could not reach Telegram API' })
    }

    // Resolve tenant
    const tenantRes = await pool.query('SELECT get_tenant_for_worker($1) AS tenant_id', [worker_id])
    const tenantId  = tenantRes.rows[0]?.tenant_id as string | null
    if (!tenantId) return res.status(404).json({ error: 'worker not found' })

    const webhookSecret   = crypto.randomBytes(32).toString('hex')
    const encryptedToken  = encryptToken(bot_token)
    const encryptedSecret = encryptToken(webhookSecret)

    const channel = await withTenant(tenantId, async (client) => {
      // Upsert — one telegram channel per worker
      const r = await client.query(`
        INSERT INTO worker_channels
          (tenant_id, worker_id, channel_type, external_id, display_name, encrypted_config, public_config)
        VALUES ($1, $2, 'telegram', $3, $4, $5, $6)
        ON CONFLICT DO NOTHING
        RETURNING id
      `, [
        tenantId,
        worker_id,
        String(botInfo.id),
        `@${botInfo.username}`,
        JSON.stringify({ bot_token: encryptedToken, webhook_secret: encryptedSecret }),
        JSON.stringify({ bot_username: botInfo.username, mode: 'dedicated_bot' }),
      ])
      return r.rows[0]
    })

    if (!channel) return res.status(409).json({ error: 'A Telegram channel already exists for this worker' })

    // Register webhook with Telegram
    const webhookUrl = `${channelBase()}/webhooks/telegram/${channel.id}/${webhookSecret}`
    await registerWebhook(bot_token, webhookUrl, webhookSecret)

    res.json({ ok: true, channel_id: channel.id, bot_username: botInfo.username, webhook_url: webhookUrl })
  } catch (err) { next(err) }
})

// ── List channels for a worker ────────────────────────────────────────────────

router.get('/channels', requireAuth, async (req, res, next) => {
  try {
    const workerId = req.query.worker_id as string
    if (!workerId) return res.status(400).json({ error: 'worker_id required' })

    const tenantRes = await pool.query('SELECT get_tenant_for_worker($1) AS tenant_id', [workerId])
    const tenantId  = tenantRes.rows[0]?.tenant_id as string | null
    if (!tenantId) return res.status(404).json({ error: 'worker not found' })

    const channels = await withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT id, channel_type, status, external_id, display_name, public_config, created_at
         FROM worker_channels WHERE tenant_id = $1 AND worker_id = $2 ORDER BY created_at`,
        [tenantId, workerId]
      )
      return r.rows
    })

    res.json({ channels })
  } catch (err) { next(err) }
})

// ── Delete / disconnect a channel ─────────────────────────────────────────────

router.delete('/channels/:id', requireAuth, async (req, res, next) => {
  try {
    const workerId = req.query.worker_id as string
    if (!workerId) return res.status(400).json({ error: 'worker_id required' })

    const tenantRes = await pool.query('SELECT get_tenant_for_worker($1) AS tenant_id', [workerId])
    const tenantId  = tenantRes.rows[0]?.tenant_id as string | null
    if (!tenantId) return res.status(404).json({ error: 'worker not found' })

    await withTenant(tenantId, async (client) => {
      const r = await client.query(
        `DELETE FROM worker_channels WHERE id = $1 AND tenant_id = $2 AND worker_id = $3 RETURNING encrypted_config`,
        [req.params.id, tenantId, workerId]
      )
      if (r.rows[0]) {
        const cfg     = r.rows[0].encrypted_config as Record<string, string>
        const token   = decryptToken(cfg.bot_token)
        if (token) deleteWebhook(token).catch(() => {})
      }
    })

    res.json({ ok: true })
  } catch (err) { next(err) }
})

// ── Telegram webhook — one URL per channel ────────────────────────────────────
// POST /webhooks/telegram/:channelId/:secret

router.post('/webhooks/telegram/:channelId/:secret', async (req, res) => {
  // Acknowledge immediately — Telegram retries if we don't respond within 5s
  res.sendStatus(200)

  const { channelId, secret } = req.params
  const update = req.body as TelegramUpdate

  const message = update.message
  if (!message?.text) return

  const chatId        = message.chat.id
  const externalUserId = String(message.from?.id ?? chatId)
  const text          = message.text.trim()
  const firstName     = message.from?.first_name ?? ''

  try {
    // Look up channel (no tenant context needed — find by ID + verify secret)
    const channelRes = await pool.query(
      `SELECT wc.id, wc.tenant_id, wc.worker_id, wc.encrypted_config
       FROM worker_channels wc
       WHERE wc.id = $1 AND wc.status = 'active' AND wc.channel_type = 'telegram'`,
      [channelId]
    )
    const channel = channelRes.rows[0]
    if (!channel) return

    // Verify webhook secret to prevent spoofed requests
    const cfg           = channel.encrypted_config as Record<string, string>
    const storedSecret  = decryptToken(cfg.webhook_secret)
    if (storedSecret && storedSecret !== secret) return

    // Queue removed — log for now
    console.log('[channels] telegram message received', {
      channelId,
      tenantId:      channel.tenant_id,
      chatId,
      text: text?.slice(0, 100),
    })
  } catch (err) {
    console.error('[channels] webhook error:', err)
  }
})

interface TelegramUpdate {
  message?: {
    chat: { id: number }
    from?: { id: number; first_name?: string }
    text?: string
  }
}

export default router
