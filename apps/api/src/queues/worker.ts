import { Worker } from 'bullmq'
import { pool } from '../db/pool.js'
import { withTenant } from '../db/withTenant.js'
import { runAgentTurn } from '../runtime/runAgentTurn.js'
import { handleComplianceCommand } from '../services/compliance.js'
import { audit } from '../services/audit.js'
import { updateEpisodicSummary } from '../services/episodic.js'
import { dispatchScheduledWork, registerOutboundAction, markOutboundSent } from '../services/scheduler.js'

function redisConnection() {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL }
  return { host: process.env.REDIS_HOST ?? 'localhost', port: 6379 }
}

export const fenWorker = new Worker(
  'fen-events',
  async (job) => {
    // ── Shared scheduler dispatcher ───────────────────────────────────────────
    if (job.name === 'dispatch_scheduled_work') {
      await dispatchScheduledWork()
      return
    }

    // ── Scheduled job execution ───────────────────────────────────────────────
    if (job.name === 'run_scheduled_job') {
      await runScheduledJob(job.data as ScheduledJobData)
      return
    }

    // ── Telegram message ──────────────────────────────────────────────────────
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

    const tenantLookup = await pool.query(
      'SELECT tenant_id FROM workers WHERE id = $1',
      [workerId]
    )
    if (!tenantLookup.rows[0]) {
      console.error(`[Queue] No tenant found for worker ${workerId}`)
      return
    }

    const tenantId = tenantLookup.rows[0].tenant_id as string

    await audit({ tenantId, action: 'job_started', actor: 'queue', target: workerId, metadata: { job_id: job.id } })

    return withTenant(tenantId, async (client) => {
      let convRes = await client.query(
        `SELECT id FROM conversations
         WHERE tenant_id = $1 AND worker_id = $2 AND external_user_id = $3 AND channel = 'telegram'`,
        [tenantId, workerId, externalUserId]
      )
      if (!convRes.rows.length) {
        convRes = await client.query(
          `INSERT INTO conversations (tenant_id, worker_id, external_user_id, channel)
           VALUES ($1, $2, $3, 'telegram') RETURNING id`,
          [tenantId, workerId, externalUserId]
        )
      }

      const conversationId = convRes.rows[0].id as string

      await client.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, content)
         VALUES ($1, $2, 'inbound', $3)`,
        [tenantId, conversationId, text]
      )
      await audit({ tenantId, action: 'message_saved', actor: 'queue', target: conversationId, metadata: { direction: 'inbound', length: text.length }, client })

      const complianceReply = await handleComplianceCommand(text, client, conversationId, tenantId)
      if (complianceReply) {
        await sendTelegram(chatId, complianceReply)
        return
      }

      const result = await runAgentTurn({ client, tenantId, workerId, conversationId, inboundText: text })

      if ((result.status === 'sent' || result.status === 'sent_with_notify') && result.message) {
        await client.query(
          `INSERT INTO messages (tenant_id, conversation_id, direction, content)
           VALUES ($1, $2, 'outbound', $3)`,
          [tenantId, conversationId, result.message]
        )
        await audit({ tenantId, action: 'message_saved', actor: 'runtime', target: conversationId, metadata: { direction: 'outbound', status: result.status }, client })

        // Idempotency guard before sending
        const { alreadySent, actionId } = await registerOutboundAction({
          client,
          tenantId,
          conversationId,
          actionType: 'telegram_message',
          targetKey:  String(chatId),
          payload:    { text: result.message },
        })

        if (!alreadySent) {
          await sendTelegram(chatId, result.message)
          await markOutboundSent({ client, actionId })
          await audit({ tenantId, action: 'message_sent', actor: 'runtime', target: conversationId, metadata: { channel: 'telegram', chat_id: chatId, status: result.status }, client })
        }

        updateEpisodicSummary(client, conversationId, text, result.message)
          .catch((e) => console.error('[episodic] post-send update failed:', e.message))
      }

      if (result.status === 'needs_approval') {
        await sendTelegram(chatId, `Your message is being reviewed. A human will approve and send it shortly.`)
        await audit({ tenantId, action: 'approval_created', actor: 'runtime', target: conversationId, metadata: { channel: 'telegram' }, client })
      }
    })
  },
  { connection: redisConnection() }
)

fenWorker.on('failed', (job, err) => {
  console.error(`[Queue] Job ${job?.id} failed:`, err.message)
  const tenantId = job?.data?.tenantId as string | undefined
  const workerId = job?.data?.workerId as string | undefined
  audit({ tenantId, action: 'job_failed', actor: 'queue', target: workerId, metadata: { job_id: job?.id, error: err.message } })
})

// ── Scheduled job runner ──────────────────────────────────────────────────────

interface ScheduledJobData {
  jobRunId:       string
  scheduledJobId: string
  tenantId:       string
  workerId:       string
  task:           string
  executionMode:  string
  outputChatId:   number | null
}

async function runScheduledJob(data: ScheduledJobData) {
  const { jobRunId, scheduledJobId, tenantId, workerId, task, outputChatId } = data

  await pool.query(
    `UPDATE job_runs SET status = 'running', started_at = now() WHERE id = $1`,
    [jobRunId]
  )

  try {
    await withTenant(tenantId, async (client) => {
      // Find or create cron conversation per worker
      let convRes = await client.query(
        `SELECT id FROM conversations
         WHERE tenant_id = $1 AND worker_id = $2 AND channel = 'cron' LIMIT 1`,
        [tenantId, workerId]
      )
      if (!convRes.rows.length) {
        convRes = await client.query(
          `INSERT INTO conversations (tenant_id, worker_id, external_user_id, channel)
           VALUES ($1, $2, 'cron', 'cron') RETURNING id`,
          [tenantId, workerId]
        )
      }
      const conversationId = convRes.rows[0].id as string

      await client.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, content)
         VALUES ($1, $2, 'inbound', $3)`,
        [tenantId, conversationId, task]
      )

      const result = await runAgentTurn({
        client, tenantId, workerId, conversationId, inboundText: task,
      })
      const output = (result.status === 'sent' || result.status === 'sent_with_notify')
        ? result.message : null

      if (output) {
        await client.query(
          `INSERT INTO messages (tenant_id, conversation_id, direction, content)
           VALUES ($1, $2, 'outbound', $3)`,
          [tenantId, conversationId, output]
        )

        if (outputChatId) {
          const { alreadySent, actionId } = await registerOutboundAction({
            client,
            tenantId,
            jobRunId,
            actionType: 'telegram_message',
            targetKey:  String(outputChatId),
            payload:    { text: output, jobRunId },
          })
          if (!alreadySent) {
            await sendTelegram(outputChatId, output)
            await markOutboundSent({ client, actionId })
          }
        }
      }

      await pool.query(
        `UPDATE job_runs
         SET status = 'completed', output = $1, completed_at = now(), finished_at = now()
         WHERE id = $2`,
        [output ?? '(no output)', jobRunId]
      )
      await pool.query(
        `UPDATE scheduled_jobs SET last_completed_at = now() WHERE id = $1`,
        [scheduledJobId]
      )
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[scheduler] job_run ${jobRunId} failed:`, msg)
    await pool.query(
      `UPDATE job_runs
       SET status = 'failed', error = $1, completed_at = now(), finished_at = now()
       WHERE id = $2`,
      [msg, jobRunId]
    )
    throw err // re-throw so BullMQ retries
  }
}

async function sendTelegram(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
}
