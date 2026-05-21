import { Router } from 'express'
import { pool } from '../db/pool.js'
import { withTenant } from '../db/withTenant.js'
import { requireAuth, requireEditor } from '../lib/auth.js'
import { approveCandidate, rejectCandidate } from '../services/memoryLearning.js'

const router = Router()

// GET /memory/core?worker_id=
router.get('/memory/core', requireAuth, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id=$1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  const r = await pool.query(
    `SELECT id, memory_key, memory_value, source_type, status, security_status, updated_at
     FROM business_memory_core
     WHERE tenant_id=$1 AND status='active'
     ORDER BY memory_key`,
    [tenantId]
  )
  res.json(r.rows)
})

// PUT /memory/core — upsert a core memory entry
router.put('/memory/core', requireEditor, async (req, res) => {
  const { worker_id, memory_key, memory_value } = req.body as Record<string, string>
  if (!worker_id || !memory_key || memory_value === undefined) {
    return res.status(400).json({ error: 'worker_id, memory_key, memory_value required' })
  }

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id=$1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  const r = await pool.query(
    `INSERT INTO business_memory_core
       (tenant_id, memory_key, memory_value, source_type, status, security_status)
     VALUES ($1,$2,$3,'user','active','approved')
     ON CONFLICT (tenant_id, owner_user_id, memory_key)
     DO UPDATE SET memory_value=$3, source_type='user', updated_at=now()
     RETURNING *`,
    [tenantId, memory_key, JSON.stringify(memory_value)]
  )
  res.json(r.rows[0])
})

// DELETE /memory/core/:key
router.delete('/memory/core/:key', requireEditor, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id=$1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  await pool.query(
    `UPDATE business_memory_core SET status='archived', updated_at=now()
     WHERE tenant_id=$1 AND memory_key=$2`,
    [tenantId, req.params.key]
  )
  res.json({ ok: true })
})

// GET /memory/candidates?worker_id=&status=pending
router.get('/memory/candidates', requireAuth, async (req, res) => {
  const { worker_id, status } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id=$1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  const r = await pool.query(
    `SELECT id, target_layer, proposed_memory_key, proposed_memory_value,
            reason, risk_level, requires_approval, status, created_at
     FROM business_memory_candidates
     WHERE tenant_id=$1 ${status ? 'AND status=$2' : ''}
     ORDER BY created_at DESC LIMIT 50`,
    status ? [tenantId, status] : [tenantId]
  )
  res.json(r.rows)
})

// POST /memory/candidates/:id/approve
router.post('/memory/candidates/:id/approve', requireEditor, async (req, res) => {
  const { worker_id } = req.body as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id=$1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  await withTenant(tenantId, async (client) => {
    await approveCandidate(client, tenantId, req.params.id, req.actor?.phone)
  })
  res.json({ ok: true })
})

// POST /memory/candidates/:id/reject
router.post('/memory/candidates/:id/reject', requireEditor, async (req, res) => {
  const { worker_id } = req.body as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id=$1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  await withTenant(tenantId, async (client) => {
    await rejectCandidate(client, tenantId, req.params.id, req.actor?.phone)
  })
  res.json({ ok: true })
})

// GET /memory/events?worker_id=
router.get('/memory/events', requireAuth, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantRes = await pool.query('SELECT tenant_id FROM workers WHERE id=$1', [worker_id])
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  const r = await pool.query(
    `SELECT id, memory_layer, action, before_value, after_value, reason,
            actor_type, source_type, created_at
     FROM business_memory_events
     WHERE tenant_id=$1
     ORDER BY created_at DESC LIMIT 100`,
    [tenantId]
  )
  res.json(r.rows)
})

export default router
