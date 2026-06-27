import { Router } from 'express'
import { handleJobCallback } from '../services/jobCallbackHandler.js'
import { handleApplyCallback } from '../services/jobNotifier.js'
import { handleOnboardingReply, handleWorkTypeCallback, handleOnboardingCallback } from '../services/telegramOnboarding.js'
import { useTelegramConnectToken } from '../services/tenantProvisioner.js'
import { sendTelegram } from '../lib/telegram.js'
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

  if (data.startsWith('ob:')) {
    const { pool } = await import('../db/pool.js')
    const r = await pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM worker_channels
       WHERE channel_type='telegram' AND (public_config->>'chat_id')::text=$1 AND status='active' LIMIT 1`,
      [String(chatId)]
    )
    const tenantId = r.rows[0]?.tenant_id
    if (tenantId) {
      await handleOnboardingCallback(tenantId, chatId, data, botToken)
    }
    return true
  }

  if (data.startsWith('profile:work_type:')) {
    const workType = data.split(':')[2]
    const { pool } = await import('../db/pool.js')
    const r = await pool.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM worker_channels
       WHERE channel_type='telegram' AND (public_config->>'chat_id')::text=$1 AND status='active' LIMIT 1`,
      [String(chatId)]
    )
    const tenantId = r.rows[0]?.tenant_id
    if (tenantId) {
      await handleWorkTypeCallback(tenantId, chatId, workType, botToken)
    }
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

  // Per-worker webhook: process message inline (queue removed)
  const msg2 = req.body?.message
  if (msg2?.text) {
    const botToken2 = env.telegramBotToken
    const { handleOnboardingReply: handleReply } = await import('../services/telegramOnboarding.js')
    await handleReply(msg2, botToken2).catch(e => console.error('[telegram] worker message error:', e))
  }
})

// Job agent webhook — handles callbacks + /start to register chat ID
telegramRouter.post('/telegram/webhook', async (req, res) => {
  res.json({ ok: true })
  const botToken = env.telegramBotToken

  if (await tryHandleCallbackQuery(req.body, botToken)) return

  const msg = req.body?.message
  if (!msg?.text) return

  const chatId    = msg.chat?.id as number
  const msgText   = msg.text as string
  const firstName = msg.chat?.first_name ?? 'there'

  // Resolve tenant from chat ID
  const { pool } = await import('../db/pool.js')
  const defaultTenantId = process.env.DEFAULT_TENANT_ID
  const tenantRes = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM worker_channels
     WHERE channel_type='telegram' AND (public_config->>'chat_id')::text=$1 AND status='active' LIMIT 1`,
    [String(chatId)]
  )
  const tenantId = tenantRes.rows[0]?.tenant_id ?? defaultTenantId

  // /connect <token> or /start connect_<token> — link Telegram to a tenant
  const connectMatch = msgText.match(/^\/(?:connect|start connect_)\s*([a-f0-9]{32})$/i)
             || msgText.match(/^\/start\s+connect_([a-f0-9]{32})$/i)
  if (connectMatch) {
    const token = connectMatch[1]
    const linked = await useTelegramConnectToken(token, chatId, botToken)
    if (linked) {
      await sendTelegram(chatId,
        `✅ <b>Telegram connected to your FEN account!</b>\n\nYou'll receive daily job matches here. FEN starts scanning now.`,
        botToken)
    } else {
      await sendTelegram(chatId,
        `❌ That connect code is invalid or expired. Go back to FEN and generate a new one.`,
        botToken)
    }
    return
  }

  // /start — default welcome
  if (msgText === '/start') {
    await sendTelegram(chatId,
      `👋 Hi ${firstName}! I'm FEN — your personal job search agent.\n\nTo connect your account, go to the FEN dashboard and tap <b>Connect Telegram</b>.`,
      botToken)
    return
  }

  // Handle onboarding replies
  if (tenantId) {
    await handleOnboardingReply(tenantId, chatId, msgText, botToken)
  }
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
