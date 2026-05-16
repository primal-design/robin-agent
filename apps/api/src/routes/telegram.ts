import { Router } from 'express'
import { eventQueue } from '../queues/eventQueue.js'

export const telegramRouter = Router()

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const TELEGRAM_API   = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`

// Per-worker webhook: POST /webhooks/telegram/:workerId
telegramRouter.post('/webhooks/telegram/:workerId', async (req, res) => {
  res.json({ ok: true }) // acknowledge immediately

  const { workerId } = req.params
  const updateId = req.body?.update_id

  if (!req.body?.message) return

  await eventQueue.add(
    'telegram_message',
    { workerId, payload: req.body },
    { jobId: `telegram_${updateId}` } // idempotency — Telegram retries same update_id
  )
})

// Legacy single-bot webhook (keep for @fen_ai_bot)
telegramRouter.post('/telegram/webhook', async (req, res) => {
  res.json({ ok: true })

  const defaultWorkerId = process.env.DEFAULT_WORKER_ID
  if (!defaultWorkerId || !req.body?.message) return

  const updateId = req.body?.update_id
  await eventQueue.add(
    'telegram_message',
    { workerId: defaultWorkerId, payload: req.body },
    { jobId: `telegram_${updateId}` }
  )
})

// Register webhook with Telegram
telegramRouter.get('/telegram/set-webhook', async (req, res) => {
  const host       = process.env.APP_URL ?? `https://${req.headers.host}`
  const workerId   = (req.query.workerId as string) ?? process.env.DEFAULT_WORKER_ID ?? ''
  const webhookUrl = workerId
    ? `${host}/webhooks/telegram/${workerId}`
    : `${host}/telegram/webhook`

  const resp = await fetch(`${TELEGRAM_API}/setWebhook?url=${encodeURIComponent(webhookUrl)}`)
  const data = await resp.json()
  res.json(data)
})
