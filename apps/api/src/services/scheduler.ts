import { Queue } from 'bullmq'
import { pool } from '../db/pool.js'

function redisConnection() {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL }
  return { host: process.env.REDIS_HOST ?? 'localhost', port: 6379 }
}

const fenQueue = new Queue('fen-events', { connection: redisConnection() })

export async function loadAndScheduleJobs(): Promise<void> {
  try {
    const jobs = await pool.query(
      `SELECT id, tenant_id, worker_id, name, task, cron_expression, output_chat_id
       FROM scheduled_jobs WHERE enabled = true`
    )

    for (const job of jobs.rows) {
      await fenQueue.add(
        'cron_task',
        {
          jobId:        job.id,
          tenantId:     job.tenant_id,
          workerId:     job.worker_id,
          task:         job.task,
          outputChatId: job.output_chat_id ?? null,
        },
        {
          repeat:  { pattern: job.cron_expression },
          jobId:   `cron_${job.id}`,
          removeOnComplete: 50,
          removeOnFail:     20,
        }
      )
    }

    console.log(`[scheduler] Loaded ${jobs.rows.length} scheduled job(s)`)
  } catch (err) {
    console.error('[scheduler] Failed to load jobs:', err instanceof Error ? err.message : err)
  }
}

export async function scheduleJob(jobId: string, cronExpression: string, data: object): Promise<void> {
  await fenQueue.add('cron_task', data, {
    repeat:           { pattern: cronExpression },
    jobId:            `cron_${jobId}`,
    removeOnComplete: 50,
    removeOnFail:     20,
  })
}

export async function removeJob(jobId: string): Promise<void> {
  await fenQueue.removeRepeatable('cron_task', { pattern: '' }, `cron_${jobId}`)
}
