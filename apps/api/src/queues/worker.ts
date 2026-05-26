import { Worker } from 'bullmq'
import { pool } from '../db/pool.js'
import { withTenant } from '../db/withTenant.js'
import { runAgentTurn } from '../runtime/runAgentTurn.js'
import { handleComplianceCommand } from '../services/compliance.js'
import { audit } from '../services/audit.js'
import { updateEpisodicSummary } from '../services/episodic.js'
import { dispatchScheduledWork, registerOutboundAction, markOutboundSent } from '../services/scheduler.js'
import {
  getProfile, setProfile, seedProfileFromSignup,
  onboardingQuestion, applyOnboardingAnswer,
  buildProfileContext, inferFromMessage,
  detectGdprRequest, formatProfileForUser,
} from '../memory/profile.js'

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
          from?: { id: number; first_name?: string }
        }
      }
    }

    const text           = payload.message?.text?.trim()
    const externalUserId = String(payload.message?.from?.id ?? payload.message?.chat.id)
    const chatId         = payload.message?.chat.id

    if (!text || !chatId) return

    const tenantLookup = await pool.query(
      'SELECT get_tenant_for_worker($1) AS tenant_id',
      [workerId]
    )
    if (!tenantLookup.rows[0]?.tenant_id) {
      console.error(`[Queue] No tenant found for worker ${workerId}`)
      return
    }

    const tenantId = tenantLookup.rows[0].tenant_id as string

    await audit({ tenantId, action: 'job_started', actor: 'queue', target: workerId, metadata: { job_id: job.id } })

    const firstName = String(payload.message?.from?.first_name || '').trim()

    return withTenant(tenantId, async (client) => {
      let convRes = await client.query(
        `SELECT id, state FROM conversations
         WHERE tenant_id = $1 AND worker_id = $2 AND external_user_id = $3 AND channel = 'telegram'`,
        [tenantId, workerId, externalUserId]
      )
      if (!convRes.rows.length) {
        convRes = await client.query(
          `INSERT INTO conversations (tenant_id, worker_id, external_user_id, channel)
           VALUES ($1, $2, $3, 'telegram') RETURNING id, state`,
          [tenantId, workerId, externalUserId]
        )
      }

      const conversationId = convRes.rows[0].id as string
      const convState: Record<string, unknown> = convRes.rows[0].state ?? {}

      // Seed profile from Telegram display name on very first message
      const profile = getProfile(convState)
      if (!profile.created_at && firstName) {
        seedProfileFromSignup(convState, firstName)
      }

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

      // ── GDPR commands ─────────────────────────────────────────────────────
      const gdprRequest = detectGdprRequest(text)
      if (gdprRequest === 'view') {
        const reply = formatProfileForUser(getProfile(convState))
        await sendTelegram(chatId, reply)
        return
      }
      if (gdprRequest === 'delete') {
        Object.keys(convState).forEach(k => delete convState[k])
        await client.query(`UPDATE conversations SET state = $1 WHERE id = $2`, [JSON.stringify(convState), conversationId])
        await client.query(`DELETE FROM messages WHERE conversation_id = $1`, [conversationId])
        await sendTelegram(chatId, `Done. I've deleted everything — your profile, conversation history, all of it.\n\nYou can start fresh whenever you're ready.`)
        return
      }

      // ── Onboarding flow ───────────────────────────────────────────────────
      const onboardingReply = handleTelegramOnboarding(convState, text)
      if (onboardingReply) {
        await client.query(`UPDATE conversations SET state = $1 WHERE id = $2`, [JSON.stringify(convState), conversationId])
        await client.query(
          `INSERT INTO messages (tenant_id, conversation_id, direction, content) VALUES ($1, $2, 'outbound', $3)`,
          [tenantId, conversationId, onboardingReply]
        )
        await sendTelegram(chatId, onboardingReply)
        return
      }

      // ── Passive profile inference ─────────────────────────────────────────
      const updatedProfile = inferFromMessage(getProfile(convState), text)
      setProfile(convState, updatedProfile)

      const userProfileCtx = buildProfileContext(getProfile(convState))
      const result = await runAgentTurn({ client, tenantId, workerId, conversationId, inboundText: text, userProfileCtx: userProfileCtx || undefined })

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

      // Persist updated profile state
      await client.query(`UPDATE conversations SET state = $1 WHERE id = $2`, [JSON.stringify(convState), conversationId])
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
  const { jobRunId, scheduledJobId, tenantId, workerId, task, executionMode, outputChatId } = data

  await pool.query(
    `UPDATE job_runs SET status = 'running', started_at = now() WHERE id = $1`,
    [jobRunId]
  )

  try {
    await withTenant(tenantId, async (client) => {
      let output: string | null = null

      if (executionMode === 'script_only') {
        // No LLM — task text is the output directly (deterministic collector)
        output = task
      } else {
        // agent_only or script_plus_agent — find or create cron conversation
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
        output = (result.status === 'sent' || result.status === 'sent_with_notify')
          ? result.message : null

        if (output) {
          await client.query(
            `INSERT INTO messages (tenant_id, conversation_id, direction, content)
             VALUES ($1, $2, 'outbound', $3)`,
            [tenantId, conversationId, output]
          )
        }
      }

      if (output && outputChatId) {
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

function handleTelegramOnboarding(state: Record<string, unknown>, userMessage: string): string | null {
  const profile = getProfile(state)
  if (profile.onboarding_completed) return null

  const step = profile.onboarding_step ?? 0

  if (step === 0) {
    const name = profile.name ? ` ${profile.name.split(' ')[0]}` : ''
    const q1 = onboardingQuestion(1, profile)
    setProfile(state, { ...profile, onboarding_step: 1 })
    return `Hey${name}! I'm Fen, your AI assistant. Just three quick questions so I can help you properly.\n\n${q1}`
  }

  if (step === 1) {
    const updated = applyOnboardingAnswer(profile, 1, userMessage)
    setProfile(state, { ...updated, onboarding_step: 2 })
    return onboardingQuestion(2, updated)
  }

  if (step === 2) {
    const updated = applyOnboardingAnswer(profile, 2, userMessage)
    setProfile(state, { ...updated, onboarding_step: 3 })
    return onboardingQuestion(3, updated)
  }

  if (step === 3) {
    const updated = applyOnboardingAnswer(profile, 3, userMessage)
    setProfile(state, { ...updated, onboarding_completed: true })
    const name = updated.name ? ` ${updated.name.split(' ')[0]}` : ''
    return `Perfect${name}, I'm all set. What can I help you with today?`
  }

  return null
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
