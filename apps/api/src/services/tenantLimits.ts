import type { PoolClient } from 'pg'
import { pool } from '../db/pool.js'

export interface TenantLimits {
  max_scheduled_jobs:       number
  max_runs_per_day:         number
  max_concurrent_runs:      number
  max_llm_calls_per_minute: number
  max_tokens_per_day:       number
}

const DEFAULTS: TenantLimits = {
  max_scheduled_jobs:       20,
  max_runs_per_day:         100,
  max_concurrent_runs:      5,
  max_llm_calls_per_minute: 10,
  max_tokens_per_day:       500000,
}

export async function getTenantLimits(tenantId: string): Promise<TenantLimits> {
  const r = await pool.query<TenantLimits>(
    `SELECT max_scheduled_jobs, max_runs_per_day, max_concurrent_runs,
            max_llm_calls_per_minute, max_tokens_per_day
     FROM tenant_limits WHERE tenant_id = $1`,
    [tenantId]
  )
  return r.rows[0] ?? DEFAULTS
}

export async function checkRunQuota(
  tenantId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const limits = await getTenantLimits(tenantId)

  // Check daily run count
  const dailyRes = await pool.query<{ runs_today: string }>(
    `SELECT COUNT(*) AS runs_today
     FROM job_runs
     WHERE tenant_id = $1
       AND started_at >= CURRENT_DATE
       AND status != 'failed'`,
    [tenantId]
  )
  const runsToday = parseInt(dailyRes.rows[0]?.runs_today ?? '0', 10)
  if (runsToday >= limits.max_runs_per_day) {
    return { allowed: false, reason: `daily_limit_exceeded: ${runsToday}/${limits.max_runs_per_day}` }
  }

  // Check concurrent runs
  const concurrentRes = await pool.query<{ running: string }>(
    `SELECT COUNT(*) AS running
     FROM job_runs
     WHERE tenant_id = $1 AND status IN ('queued', 'running')`,
    [tenantId]
  )
  const running = parseInt(concurrentRes.rows[0]?.running ?? '0', 10)
  if (running >= limits.max_concurrent_runs) {
    return { allowed: false, reason: `concurrent_limit_exceeded: ${running}/${limits.max_concurrent_runs}` }
  }

  return { allowed: true }
}

export async function checkJobCountQuota(
  tenantId: string
): Promise<{ allowed: boolean; reason?: string }> {
  const limits = await getTenantLimits(tenantId)

  const r = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM scheduled_jobs WHERE tenant_id=$1 AND enabled=true`,
    [tenantId]
  )
  const count = parseInt(r.rows[0]?.count ?? '0', 10)
  if (count >= limits.max_scheduled_jobs) {
    return { allowed: false, reason: `job_count_limit_exceeded: ${count}/${limits.max_scheduled_jobs}` }
  }
  return { allowed: true }
}

// Ensure a tenant_limits row exists (called on tenant creation or first use)
export async function ensureTenantLimits(
  client: PoolClient,
  tenantId: string
): Promise<void> {
  await client.query(
    `INSERT INTO tenant_limits (tenant_id) VALUES ($1) ON CONFLICT DO NOTHING`,
    [tenantId]
  )
}
