import { Worker } from 'bullmq'
import { pool } from '../db/pool.js'
import { withTenant } from '../db/withTenant.js'
import { runAgentTurn } from '../runtime/runAgentTurn.js'
import { handleComplianceCommand } from '../services/compliance.js'

function redisConnection() {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL }
  return { host: process.env.REDIS_HOST ?? 'localhost', port: 6379 }
}

export const fenWorker = new Worker(
  'fen-events',
  async (job) => {
    if (job.name !== 'telegram_message') return

    const { workerId, payload } = job.data as {
      workerId: string
      payload: {
        update_id: number
        message?: {
          text?: string
          chat: { id: number }
          from?: { id: number }
        }
      }
    }

    const text           = payload.message?.text?.trim()
    const externalUserId = String(payload.message?.from?.id ?? payload.message?.chat.id)
    const chatId         = payload.message?.chat.id

    if (!text || !chatId) return

    const allWorkers = await pool.query('SELECT id FROM workers')
    console.log(`[Queue] DB has ${allWorkers.rows.length} workers:`, allWorkers.rows.map((r:any) => r.id))

    const tenantLookup = await pool.query(
      'SELECT tenant_id FROM workers WHERE id = $1',
      [workerId]
    )
    if (!tenantLookup.rows[0]) {
      console.error(`[Queue] No tenant found for worker ${workerId}`)
      return
    }

    const tenantId = tenantLookup.rows[0].tenant_id as string

    return withTenant(tenantId, async (client) => {
      // Find or create conversation
      let convRes = await client.query(
        `SELECT id FROM conversations
         WHERE tenant_id = $1 AND worker_id = $2 AND external_user_id = $3 AND channel = 'telegram'`,
        [tenantId, workerId, externalUserId]
      )

      if (!convRes.rows.length) {
        convRes = await client.query(
          `INSERT INTO conversations (tenant_id, worker_id, external_user_id, channel)
           VALUES ($1, $2, $3, 'telegram')
           RETURNING id`,
          [tenantId, workerId, externalUserId]
        )
      }

      const conversationId = convRes.rows[0].id as string

      // Save inbound message
      await client.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, content)
         VALUES ($1, $2, 'inbound', $3)`,
        [tenantId, conversationId, text]
      )

      // Handle compliance commands before hitting the AI
      const complianceReply = await handleComplianceCommand(
        text, client, conversationId, tenantId
      )
      if (complianceReply) {
        await sendTelegram(chatId, complianceReply)
        return
      }

      const result = await runAgentTurn({
        client,
        tenantId,
        workerId,
        conversationId,
        inboundText: text,
      })

      if (result.status === 'sent' && result.message) {
        await client.query(
          `INSERT INTO messages (tenant_id, conversation_id, direction, content)
           VALUES ($1, $2, 'outbound', $3)`,
          [tenantId, conversationId, result.message]
        )
        await sendTelegram(chatId, result.message)
      }

      if (result.status === 'needs_approval') {
        await sendTelegram(
          chatId,
          `Your message is being reviewed. A human will approve and send it shortly.`
        )
      }
    })
  },
  { connection: redisConnection() }
)

fenWorker.on('failed', (job, err) => {
  console.error(`[Queue] Job ${job?.id} failed:`, err.message)
})

async function sendTelegram(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
}
