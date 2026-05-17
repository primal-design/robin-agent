import { Router } from 'express'
import { pool } from '../db/pool.js'
import { audit } from '../services/audit.js'

export const agentRouter = Router()

const DEFAULT_TENANT = () => process.env.DEFAULT_TENANT_ID ?? ''
const DEFAULT_WORKER = () => process.env.DEFAULT_WORKER_ID ?? ''

// GET /agent/prompt — read current system prompt
agentRouter.get('/agent/prompt', async (req, res) => {
  const tenantId = (req.query.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.query.workerId as string) || DEFAULT_WORKER()

  const result = await pool.query(
    `SELECT manifest->'prompt'->>'system' AS prompt FROM workers WHERE id = $1`,
    [workerId]
  )
  res.json({ prompt: result.rows[0]?.prompt ?? '' })
})

// PUT /agent/prompt — update system prompt from dashboard
agentRouter.put('/agent/prompt', async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.body.workerId as string) || DEFAULT_WORKER()
  const { prompt } = req.body as { prompt: string }
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' })

  await pool.query(
    `UPDATE workers
     SET manifest = jsonb_set(manifest, '{prompt,system}', $1::jsonb)
     WHERE id = $2`,
    [JSON.stringify(prompt), workerId]
  )
  await audit({ tenantId, action: 'prompt_updated', actor: 'human', target: workerId })
  res.json({ ok: true })
})

// GET /agent/memory — read all business memory
agentRouter.get('/agent/memory', async (req, res) => {
  const tenantId = (req.query.tenantId as string) || DEFAULT_TENANT()
  const result = await pool.query(
    `SELECT key, value FROM business_memory WHERE tenant_id = $1 ORDER BY key`,
    [tenantId]
  )
  res.json({ memory: result.rows })
})

// PUT /agent/memory — upsert a memory key
agentRouter.put('/agent/memory', async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const { key, value } = req.body as { key: string; value: string }
  if (!key?.trim()) return res.status(400).json({ error: 'key required' })

  await pool.query(
    `INSERT INTO business_memory (tenant_id, key, value)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3`,
    [tenantId, key.trim(), value ?? '']
  )
  await audit({ tenantId, action: 'memory_updated', actor: 'human', target: key })
  res.json({ ok: true })
})

// DELETE /agent/memory/:key — remove a memory key
agentRouter.delete('/agent/memory/:key', async (req, res) => {
  const tenantId = (req.query.tenantId as string) || DEFAULT_TENANT()
  await pool.query(
    `DELETE FROM business_memory WHERE tenant_id = $1 AND key = $2`,
    [tenantId, req.params.key]
  )
  await audit({ tenantId, action: 'memory_deleted', actor: 'human', target: req.params.key })
  res.json({ ok: true })
})
