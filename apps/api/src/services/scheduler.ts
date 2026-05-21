import { Queue } from 'bullmq'
import { pool } from '../db/pool.js'
import crypto from 'crypto'
import { checkRunQuota } from './tenantLimits.js'

function redisConnection() {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL }
  return { host: process.env.REDIS_HOST ?? 'localhost', port: 6379 }
}

const fenQueue = new Queue('fen-events', { connection: redisConnection() })

// ── Shared dispatcher ─────────────────────────────────────────────────────────
// One BullMQ repeat job calls this every minute.
// Queries scheduled_jobs with FOR UPDATE SKIP LOCKED so multiple workers
// never double-dispatch the same row.
export async function dispatchScheduledWork(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const due = await client.query<{
      id:              string
      tenant_id:       string
      worker_id:       string
      task:            string
      execution_mode:  string
      memory_policy:   object
      output_contract: object
      output_chat_id:  number | null
      next_run_at:     Date
      cron_expression: string
    }>(
      `SELECT id, tenant_id, worker_id, task, execution_mode,
              memory_policy, output_contract, output_chat_id,
              next_run_at, cron_expression
       FROM scheduled_jobs
       WHERE enabled = true
         AND next_run_at <= now()
       ORDER BY next_run_at ASC
       LIMIT 500
       FOR UPDATE SKIP LOCKED`
    )

    for (const job of due.rows) {
      const scheduledFor    = job.next_run_at
      const idempotencyKey  = `${job.id}:${scheduledFor.toISOString()}`
      const nextRunAt       = computeNextRun(job.cron_expression)

      // Advance next_run_at immediately — before execution
      await client.query(
        `UPDATE scheduled_jobs
         SET next_run_at        = $1,
             last_scheduled_for = $2,
             last_dispatched_at = now()
         WHERE id = $3`,
        [nextRunAt, scheduledFor, job.id]
      )

      // Create job_run record
      const runRes = await client.query<{ id: string }>(
        `INSERT INTO job_runs
           (job_id, tenant_id, scheduled_for, idempotency_key, status, queued_at, input_context)
         VALUES ($1, $2, $3, $4, 'pending', now(), $5)
         ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
         RETURNING id`,
        [
          job.id,
          job.tenant_id,
          scheduledFor,
          idempotencyKey,
          JSON.stringify({
            task:           job.task,
            execution_mode: job.execution_mode,
            memory_policy:  job.memory_policy,
            output_contract: job.output_contract,
          }),
        ]
      )

      if (!runRes.rows[0]) continue // already dispatched (idempotency)

      const jobRunId = runRes.rows[0].id

      // Check tenant quota before enqueuing
      const quota = await checkRunQuota(job.tenant_id)
      if (!quota.allowed) {
        await client.query(
          `UPDATE job_runs SET status='failed', error=$1, finished_at=now() WHERE id=$2`,
          [`quota_exceeded: ${quota.reason}`, jobRunId]
        )
        console.warn(`[scheduler] Tenant ${job.tenant_id} quota exceeded: ${quota.reason}`)
        continue
      }

      // Enqueue worker job
      const bullJob = await fenQueue.add(
        'run_scheduled_job',
        {
          jobRunId,
          scheduledJobId:  job.id,
          tenantId:        job.tenant_id,
          workerId:        job.worker_id,
          task:            job.task,
          executionMode:   job.execution_mode,
          outputChatId:    job.output_chat_id ?? null,
        },
        {
          jobId:            `run_${jobRunId}`,
          attempts:         3,
          backoff:          { type: 'exponential', delay: 5000 },
          removeOnComplete: 100,
          removeOnFail:     50,
        }
      )

      // Save bullmq job id back to run record
      await client.query(
        `UPDATE job_runs SET bullmq_job_id = $1, status = 'queued' WHERE id = $2`,
        [bullJob.id, jobRunId]
      )
    }

    await client.query('COMMIT')

    if (due.rows.length > 0) {
      console.log(`[scheduler] Dispatched ${due.rows.length} job(s)`)
    }
  } catch (err) {
    await client.query('ROLLBACK')
    console.error('[scheduler] Dispatch failed:', err instanceof Error ? err.message : err)
  } finally {
    client.release()
  }
}

// ── Register shared dispatcher as one BullMQ repeat job ───────────────────────
export async function startDispatcher(): Promise<void> {
  try {
    await fenQueue.add(
      'dispatch_scheduled_work',
      {},
      {
        repeat:           { pattern: '* * * * *' },
        jobId:            'platform_dispatcher',
        removeOnComplete: 10,
        removeOnFail:     5,
      }
    )
    console.log('[scheduler] Dispatcher registered')
  } catch (err) {
    console.error('[scheduler] Failed to start dispatcher:', err instanceof Error ? err.message : err)
  }
}

// ── Cron expression → next Date ───────────────────────────────────────────────
// Handles standard 5-field cron: minute hour dom month dow
// Wildcards (*) are fully supported. Specific values and ranges are not parsed
// here — use cron-parser package when those are needed.
function computeNextRun(cronExpr: string): Date {
  const now = new Date()
  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setMinutes(next.getMinutes() + 1) // floor to next minute

  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) return next

  const [minF, hourF, , , ] = parts

  // Advance to matching minute
  if (minF !== '*') {
    const targetMin = parseInt(minF, 10)
    if (!isNaN(targetMin)) {
      if (next.getMinutes() > targetMin) {
        next.setHours(next.getHours() + 1)
      }
      next.setMinutes(targetMin)
    }
  }

  // Advance to matching hour
  if (hourF !== '*') {
    const targetHour = parseInt(hourF, 10)
    if (!isNaN(targetHour)) {
      if (next.getHours() > targetHour) {
        next.setDate(next.getDate() + 1)
      }
      next.setHours(targetHour)
      if (minF === '*') next.setMinutes(0)
    }
  }

  return next
}

// ── CRUD helpers for route layer ──────────────────────────────────────────────
export async function createScheduledJob(params: {
  tenantId:       string
  workerId:       string
  name:           string
  task:           string
  cronExpression: string
  outputChatId?:  number
  executionMode?: string
  memoryPolicy?:  object
  outputContract?: object
  timezone?:      string
}): Promise<{ id: string }> {
  const nextRunAt = computeNextRunSafe(params.cronExpression)
  const r = await pool.query<{ id: string }>(
    `INSERT INTO scheduled_jobs
       (tenant_id, worker_id, name, task, cron_expression, output_chat_id,
        execution_mode, memory_policy, output_contract, timezone, next_run_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      params.tenantId,
      params.workerId,
      params.name,
      params.task,
      params.cronExpression,
      params.outputChatId ?? null,
      params.executionMode ?? 'agent_only',
      JSON.stringify(params.memoryPolicy   ?? {}),
      JSON.stringify(params.outputContract ?? {}),
      params.timezone ?? 'UTC',
      nextRunAt,
    ]
  )
  return r.rows[0]
}

export async function disableScheduledJob(jobId: string): Promise<void> {
  await pool.query(
    `UPDATE scheduled_jobs SET enabled = false, next_run_at = NULL WHERE id = $1`,
    [jobId]
  )
}

export async function deleteScheduledJob(jobId: string): Promise<void> {
  await pool.query('DELETE FROM scheduled_jobs WHERE id = $1', [jobId])
}

function computeNextRunSafe(cronExpr: string): Date {
  try {
    return computeNextRun(cronExpr)
  } catch {
    const next = new Date()
    next.setSeconds(0, 0)
    next.setMinutes(next.getMinutes() + 1)
    return next
  }
}

// ── Outbound action idempotency ───────────────────────────────────────────────
export async function registerOutboundAction(params: {
  client:          import('pg').PoolClient
  tenantId:        string
  jobRunId?:       string
  conversationId?: string
  actionType:      string
  targetKey:       string
  payload:         object
}): Promise<{ alreadySent: boolean; actionId: string }> {
  const idempotencyKey = crypto
    .createHash('sha256')
    .update(`${params.actionType}:${params.targetKey}:${JSON.stringify(params.payload)}`)
    .digest('hex')
    .slice(0, 32)

  const r = await params.client.query<{ id: string; status: string }>(
    `INSERT INTO outbound_actions
       (tenant_id, job_run_id, conversation_id, action_type, target_key, idempotency_key, payload_hash, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending')
     ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
     RETURNING id, status`,
    [
      params.tenantId,
      params.jobRunId        ?? null,
      params.conversationId  ?? null,
      params.actionType,
      params.targetKey,
      idempotencyKey,
      idempotencyKey,
    ]
  )

  if (!r.rows[0]) {
    // Conflict — already sent
    const existing = await params.client.query<{ id: string }>(
      `SELECT id FROM outbound_actions WHERE tenant_id=$1 AND idempotency_key=$2`,
      [params.tenantId, idempotencyKey]
    )
    return { alreadySent: true, actionId: existing.rows[0]?.id ?? '' }
  }

  return { alreadySent: false, actionId: r.rows[0].id }
}

export async function markOutboundSent(params: {
  client:             import('pg').PoolClient
  actionId:           string
  providerMessageId?: string
}): Promise<void> {
  await params.client.query(
    `UPDATE outbound_actions
     SET status = 'sent', sent_at = now(), provider_message_id = $1, updated_at = now()
     WHERE id = $2`,
    [params.providerMessageId ?? null, params.actionId]
  )
}
