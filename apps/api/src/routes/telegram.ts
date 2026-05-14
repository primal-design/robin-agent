import { Router } from 'express'
import { chatService } from '../services/chat.service.js'
import { findOrCreateUser, db } from '../db/client.js'

const router = Router()

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN ?? ''
const TELEGRAM_API   = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`

async function sendMessage(chatId: number, text: string) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
}

router.post('/webhook', async (req, res) => {
  // Acknowledge immediately so Telegram doesn't retry
  res.sendStatus(200)

  try {
    const message = req.body?.message
    if (!message || !message.text) return

    const chatId   = message.chat.id as number
    const text     = String(message.text).trim()
    const tgUserId = String(message.from?.id ?? chatId)

    // Use telegram:<id> as the unique identifier
    const userId = await findOrCreateUser(`telegram:${tgUserId}`)

    // Seed profile from waitlist if exists
    const username = message.from?.username ?? ''
    const firstName = message.from?.first_name ?? ''
    const lastName  = message.from?.last_name ?? ''
    const fullName  = [firstName, lastName].filter(Boolean).join(' ')

    const waitlist = await db.query(
      `SELECT name, role FROM waitlist WHERE phone=$1 LIMIT 1`,
      [`telegram:${tgUserId}`]
    )
    const meta = waitlist.rows[0]
      ? { name: waitlist.rows[0].name, signupReason: waitlist.rows[0].role }
      : fullName ? { name: fullName } : undefined

    const reply = await chatService(userId, text, meta)
    await sendMessage(chatId, reply)
  } catch (err) {
    console.error('[Telegram]', err)
  }
})

// Register webhook with Telegram
router.get('/set-webhook', async (req, res) => {
  const host = process.env.APP_URL ?? `https://${req.headers.host}`
  const webhookUrl = `${host}/telegram/webhook`
  const resp = await fetch(`${TELEGRAM_API}/setWebhook?url=${encodeURIComponent(webhookUrl)}`)
  const data = await resp.json()
  res.json(data)
})

export default router
