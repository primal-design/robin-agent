import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth, requireEditor } from '../lib/auth.js'

const router = Router()

// GET /scheduled-jobs?worker_id=
router.get('/scheduled-jobs', requireAuth, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id = $1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })

  const r = await pool.query(
    `SELECT id, name, task, cron_expression, output_chat_id, enabled, last_run_at, created_at
     FROM scheduled_jobs WHERE tenant_id = $1 AND worker_id = $2 ORDER BY created_at DESC`,
    [tenantRes.rows[0].tenant_id, worker_id]
  )
  res.json(r.rows)
})

// POST /scheduled-jobs
router.post('/scheduled-jobs', requireEditor, async (req, res) => {
  const { worker_id, name, task, cron_expression, output_chat_id } = req.body as Record<string, string>
  if (!worker_id || !name || !task || !cron_expression) {
    return res.status(400).json({ error: 'worker_id, name, task, cron_expression required' })
  }

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id = $1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  const r = await pool.query(
    `INSERT INTO scheduled_jobs (tenant_id, worker_id, name, task, cron_expression, output_chat_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tenantId, worker_id, name, task, cron_expression, output_chat_id ? parseInt(output_chat_id) : null]
  )
  const job = r.rows[0]
  res.status(201).json(job)
})

// PATCH /scheduled-jobs/:id
router.patch('/scheduled-jobs/:id', requireEditor, async (req, res) => {
  const { id } = req.params
  const { name, task, cron_expression, output_chat_id, enabled } = req.body as Record<string, string>

  const existing = await pool.query('SELECT * FROM scheduled_jobs WHERE id = $1', [id])
  if (!existing.rows[0]) return res.status(404).json({ error: 'not_found' })

  const r = await pool.query(
    `UPDATE scheduled_jobs
     SET name            = COALESCE($1, name),
         task            = COALESCE($2, task),
         cron_expression = COALESCE($3, cron_expression),
         output_chat_id  = COALESCE($4, output_chat_id),
         enabled         = COALESCE($5, enabled)
     WHERE id = $6
     RETURNING *`,
    [
      name ?? null,
      task ?? null,
      cron_expression ?? null,
      output_chat_id !== undefined ? parseInt(output_chat_id) : null,
      enabled !== undefined ? String(enabled) === 'true' : null,
      id,
    ]
  )
  const updated = r.rows[0]

  res.json(updated)
})

// DELETE /scheduled-jobs/:id
router.delete('/scheduled-jobs/:id', requireEditor, async (req, res) => {
  const { id } = req.params
  await pool.query('DELETE FROM scheduled_jobs WHERE id = $1', [id])
  res.json({ ok: true })
})

// GET /scheduled-jobs/:id/runs
router.get('/scheduled-jobs/:id/runs', requireAuth, async (req, res) => {
  const r = await pool.query(
    `SELECT id, status, output, started_at, completed_at
     FROM job_runs WHERE job_id = $1 ORDER BY started_at DESC LIMIT 20`,
    [req.params.id]
  )
  res.json(r.rows)
})

export default router
