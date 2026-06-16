import { Router } from 'express'
import { eventQueue } from '../queues/eventQueue.js'
import { audit } from '../services/audit.js'
import { handleJobCallback } from '../services/jobCallbackHandler.js'
import { handleApplyCallback } from '../services/jobNotifier.js'
import { env } from '../config/env.js'

export const telegramRouter = Router()

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const TELEGRAM_API   = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`

// ── Shared: handle callback_query (inline button press) ───────────────────────

async function tryHandleCallbackQuery(body: Record<string, unknown>, botToken: string): Promise<boolean> {
  const cq = body.callback_query as Record<string, unknown> | undefined
  if (!cq) return false

  const data = cq.data as string | undefined
  if (!data) return false

  const msg    = cq.message as Record<string, unknown> | undefined
  const chatId = (msg?.chat as Record<string, unknown>)?.id as number
  const msgId  = msg?.message_id as number
  const cbId   = cq.id as string

  if (data.startsWith('job:')) {
    await handleJobCallback({ callbackQueryId: cbId, chatId, messageId: msgId, data, botToken })
    return true
  }

  if (data.startsWith('apply:')) {
    // Resolve tenantId from chatId
    const { pool } = await import('../db/pool.js')
    const r = await pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM worker_channels
       WHERE channel_type='telegram' AND external_id=$1 AND is_active=true LIMIT 1`,
      [String(chatId)]
    )
    const tenantId = r.rows[0]?.tenant_id
    if (tenantId) {
      await handleApplyCallback({ callbackQueryId: cbId, chatId, messageId: msgId, data, tenantId, botToken })
    }
    return true
  }

  return false
}

// Per-worker webhook: POST /webhooks/telegram/:workerId
telegramRouter.post('/webhooks/telegram/:workerId', async (req, res) => {
  res.json({ ok: true }) // acknowledge immediately

  const { workerId } = req.params
  const updateId = req.body?.update_id
  const botToken = env.telegramBotToken

  // Handle inline button presses directly — don't queue
  if (await tryHandleCallbackQuery(req.body, botToken)) return

  if (!req.body?.message) return

  audit({ action: 'webhook_received', actor: 'telegram', target: workerId, metadata: { update_id: updateId, chat_id: req.body.message?.chat?.id } })

  await eventQueue.add(
    'telegram_message',
    { workerId, payload: req.body },
    { jobId: `telegram_${updateId}` }
  )

  audit({ action: 'job_queued', actor: 'telegram', target: workerId, metadata: { update_id: updateId, job_id: `telegram_${updateId}` } })
})

// Legacy single-bot webhook (keep for @fen_ai_bot)
telegramRouter.post('/telegram/webhook', async (req, res) => {
  res.json({ ok: true })

  const defaultWorkerId = process.env.DEFAULT_WORKER_ID
  const botToken = env.telegramBotToken

  // Handle inline button presses directly — don't queue
  if (await tryHandleCallbackQuery(req.body, botToken)) return

  if (!defaultWorkerId || !req.body?.message) return

  const updateId = req.body?.update_id

  audit({ action: 'webhook_received', actor: 'telegram', target: defaultWorkerId, metadata: { update_id: updateId, chat_id: req.body.message?.chat?.id } })

  await eventQueue.add(
    'telegram_message',
    { workerId: defaultWorkerId, payload: req.body },
    { jobId: `telegram_${updateId}` }
  )

  audit({ action: 'job_queued', actor: 'telegram', target: defaultWorkerId, metadata: { update_id: updateId, job_id: `telegram_${updateId}` } })
})

// Register webhook with Telegram
telegramRouter.get('/telegram/set-webhook', async (req, res) => {
  const host       = process.env.APP_URL ?? `https://${req.headers.host}`
  const workerId   = (req.query.workerId as string) ?? process.env.DEFAULT_WORKER_ID ?? ''
  const webhookUrl = workerId
    ? `${host}/webhooks/telegram/${workerId}`
    : `${host}/telegram/webhook`

  const resp = await fetch(`${TELEGRAM_API}/setWebhook`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url: webhookUrl, allowed_updates: ['message', 'callback_query'] }),
  })
  const data = await resp.json()
  res.json(data)
})
