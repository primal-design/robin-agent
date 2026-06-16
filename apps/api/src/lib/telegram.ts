import { env } from '../config/env.js'

export async function sendTyping(chatId: number, botToken?: string): Promise<void> {
  const token = botToken || env.telegramBotToken
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, action: 'typing' }),
  }).catch(() => {})
}

export async function sendTelegram(chatId: number, text: string, botToken?: string): Promise<void> {
  const token = botToken || env.telegramBotToken
  if (!token) { console.warn('[telegram] no bot token — cannot send'); return }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error(`[telegram] sendMessage failed ${res.status}: ${body}`)
  }
}

export interface InlineButton {
  text:          string
  callback_data: string
}

export async function sendTelegramWithButtons(
  chatId:    number,
  text:      string,
  buttons:   InlineButton[][],  // rows of buttons
  botToken?: string
): Promise<string | null> {
  const token = botToken || env.telegramBotToken
  if (!token) { console.warn('[telegram] no bot token — cannot send'); return null }

  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      chat_id:    chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: buttons },
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error(`[telegram] sendMessage (buttons) failed ${res.status}: ${body}`)
    return null
  }
  const data = await res.json() as { ok: boolean; result?: { message_id: number } }
  return data.result ? String(data.result.message_id) : null
}

export async function answerCallbackQuery(
  callbackQueryId: string,
  text:            string,
  botToken?:       string
): Promise<void> {
  const token = botToken || env.telegramBotToken
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: false }),
  }).catch(() => {})
}

export async function editTelegramMessage(
  chatId:    number,
  messageId: number,
  text:      string,
  botToken?: string
): Promise<void> {
  const token = botToken || env.telegramBotToken
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML' }),
  }).catch(() => {})
}

export async function registerWebhook(botToken: string, webhookUrl: string, secret: string): Promise<void> {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ url: webhookUrl, secret_token: secret, allowed_updates: ['message'] }),
  })
  if (!res.ok) throw new Error(`setWebhook failed: ${await res.text()}`)
}

export async function deleteWebhook(botToken: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, { method: 'POST' })
}

export async function getBotInfo(botToken: string): Promise<{ id: number; username: string }> {
  const res  = await fetch(`https://api.telegram.org/bot${botToken}/getMe`)
  const data = await res.json() as { ok: boolean; result: { id: number; username: string } }
  if (!data.ok) throw new Error('getMe failed')
  return data.result
}
