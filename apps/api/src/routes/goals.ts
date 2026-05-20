import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth, requireEditor } from '../lib/auth.js'

const router = Router()

// GET /goals?worker_id=&conversation_id=
router.get('/goals', requireAuth, async (req, res) => {
  const { worker_id, conversation_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id = $1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })

  const conditions = ['tenant_id = $1', 'worker_id = $2']
  const params: unknown[] = [tenantRes.rows[0].tenant_id, worker_id]

  if (conversation_id) {
    conditions.push(`conversation_id = $${params.length + 1}`)
    params.push(conversation_id)
  }

  const r = await pool.query(
    `SELECT id, title, description, status, progress, created_at, updated_at, completed_at
     FROM goals WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT 50`,
    params
  )
  res.json(r.rows)
})

// POST /goals
router.post('/goals', requireEditor, async (req, res) => {
  const { worker_id, conversation_id, title, description } = req.body as Record<string, string>
  if (!worker_id || !title) return res.status(400).json({ error: 'worker_id and title required' })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id = $1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  const r = await pool.query(
    `INSERT INTO goals (tenant_id, worker_id, conversation_id, title, description)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [tenantId, worker_id, conversation_id ?? null, title, description ?? null]
  )
  res.status(201).json(r.rows[0])
})

// PATCH /goals/:id
router.patch('/goals/:id', requireEditor, async (req, res) => {
  const { id } = req.params
  const { status, progress, title, description } = req.body as Record<string, string>

  const r = await pool.query(
    `UPDATE goals
     SET status      = COALESCE($1, status),
         progress    = COALESCE($2, progress),
         title       = COALESCE($3, title),
         description = COALESCE($4, description),
         updated_at  = now(),
         completed_at = CASE WHEN $1 = 'completed' THEN now() ELSE completed_at END
     WHERE id = $5
     RETURNING *`,
    [status ?? null, progress ?? null, title ?? null, description ?? null, id]
  )
  if (!r.rows[0]) return res.status(404).json({ error: 'not_found' })
  res.json(r.rows[0])
})

// DELETE /goals/:id
router.delete('/goals/:id', requireEditor, async (req, res) => {
  await pool.query(`UPDATE goals SET status = 'cancelled', updated_at = now() WHERE id = $1`, [req.params.id])
  res.json({ ok: true })
})

export default router
