import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth, requireEditor } from '../lib/auth.js'

const router = Router()

const VALID_EXEC_MODES = new Set(['agent_only', 'script_plus_agent', 'script_only'])

// Validate IANA timezone using the runtime's Intl support (Node 18+).
// Falls back to a simple UTC allowance if the API is unavailable.
function isValidTimezone(tz: string): boolean {
  try {
    // Intl.supportedValuesOf is available in Node 18+
    const supported = (Intl as any).supportedValuesOf('timeZone') as string[]
    return supported.includes(tz)
  } catch {
    // Fallback: attempt to construct a formatter; throws for invalid zones
    try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true }
    catch { return false }
  }
}

function validateJobFields(body: Record<string, string>): string | null {
  const { execution_mode, timezone, task } = body

  if (execution_mode && !VALID_EXEC_MODES.has(execution_mode)) {
    return `execution_mode must be one of: ${[...VALID_EXEC_MODES].join(', ')}`
  }
  if (timezone && !isValidTimezone(timezone)) {
    return `timezone must be a valid IANA timezone (e.g. Europe/London, UTC)`
  }
  if (execution_mode === 'agent_only' && task !== undefined && !task.trim()) {
    return `agent_only mode requires a non-empty task`
  }
  if (execution_mode === 'script_plus_agent' && task !== undefined && !task.trim()) {
    return `script_plus_agent mode requires a non-empty task`
  }
  return null
}

// GET /scheduled-jobs?worker_id=
router.get('/scheduled-jobs', requireAuth, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id = $1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })

  const r = await pool.query(
    `SELECT id, name, task, cron_expression, output_chat_id, enabled,
            timezone, execution_mode, last_run_at, last_completed_at, next_run_at, created_at
     FROM scheduled_jobs WHERE tenant_id = $1 AND worker_id = $2 ORDER BY created_at DESC`,
    [tenantRes.rows[0].tenant_id, worker_id]
  )
  res.json(r.rows)
})

// POST /scheduled-jobs
router.post('/scheduled-jobs', requireEditor, async (req, res) => {
  const body = req.body as Record<string, string>
  const { worker_id, name, task, cron_expression, output_chat_id, timezone, execution_mode } = body

  if (!worker_id || !name || !task || !cron_expression) {
    return res.status(400).json({ error: 'worker_id, name, task, cron_expression required' })
  }

  const validationErr = validateJobFields(body)
  if (validationErr) return res.status(400).json({ error: validationErr })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id = $1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  const r = await pool.query(
    `INSERT INTO scheduled_jobs
       (tenant_id, worker_id, name, task, cron_expression, output_chat_id, timezone, execution_mode)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      tenantId, worker_id, name, task, cron_expression,
      output_chat_id ? parseInt(output_chat_id) : null,
      timezone || 'UTC',
      execution_mode || 'agent_only',
    ]
  )
  res.status(201).json(r.rows[0])
})

// PATCH /scheduled-jobs/:id
router.patch('/scheduled-jobs/:id', requireEditor, async (req, res) => {
  const { id } = req.params
  const body = req.body as Record<string, string>
  const { name, task, cron_expression, output_chat_id, enabled, timezone, execution_mode } = body

  const existing = await pool.query('SELECT * FROM scheduled_jobs WHERE id = $1', [id])
  if (!existing.rows[0]) return res.status(404).json({ error: 'not_found' })

  const validationErr = validateJobFields(body)
  if (validationErr) return res.status(400).json({ error: validationErr })

  const r = await pool.query(
    `UPDATE scheduled_jobs
     SET name            = COALESCE($1, name),
         task            = COALESCE($2, task),
         cron_expression = COALESCE($3, cron_expression),
         output_chat_id  = COALESCE($4, output_chat_id),
         enabled         = COALESCE($5, enabled),
         timezone        = COALESCE($6, timezone),
         execution_mode  = COALESCE($7, execution_mode)
     WHERE id = $8
     RETURNING *`,
    [
      name ?? null,
      task ?? null,
      cron_expression ?? null,
      output_chat_id !== undefined ? parseInt(output_chat_id) : null,
      enabled !== undefined ? String(enabled) === 'true' : null,
      timezone ?? null,
      execution_mode ?? null,
      id,
    ]
  )
  res.json(r.rows[0])
})

// DELETE /scheduled-jobs/:id
router.delete('/scheduled-jobs/:id', requireEditor, async (req, res) => {
  await pool.query('DELETE FROM scheduled_jobs WHERE id = $1', [req.params.id])
  res.json({ ok: true })
})

// GET /scheduled-jobs/:id/runs
router.get('/scheduled-jobs/:id/runs', requireAuth, async (req, res) => {
  const r = await pool.query(
    `SELECT id, status, output, error, started_at, completed_at, finished_at,
            input_context, bullmq_job_id, attempt_count
     FROM job_runs WHERE job_id = $1 ORDER BY started_at DESC LIMIT 20`,
    [req.params.id]
  )
  res.json(r.rows)
})

export default router
