import { Router } from 'express'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../db/pool.js'
import { audit } from '../services/audit.js'

export const agentRouter = Router()

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_TENANT = () => process.env.DEFAULT_TENANT_ID ?? ''
const DEFAULT_WORKER = () => process.env.DEFAULT_WORKER_ID ?? ''

function loadFilePrompt(): string {
  try {
    return readFileSync(resolve(__dirname, '../workers/fen.prompt.md'), 'utf-8').trim()
  } catch { return '' }
}

// GET /agent/prompt — returns active prompt, file baseline, and history
agentRouter.get('/agent/prompt', async (req, res) => {
  const workerId  = (req.query.workerId  as string) || DEFAULT_WORKER()
  const tenantId  = (req.query.tenantId  as string) || DEFAULT_TENANT()

  const workerRes = await pool.query(
    `SELECT runtime_prompt FROM workers WHERE id = $1`, [workerId]
  )
  const history = await pool.query(
    `SELECT id, source, saved_by, created_at,
            LEFT(prompt, 120) AS preview
     FROM prompt_history
     WHERE worker_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [workerId]
  )

  res.json({
    active:    workerRes.rows[0]?.runtime_prompt ?? null,
    baseline:  loadFilePrompt(),
    source:    workerRes.rows[0]?.runtime_prompt ? 'dashboard_override' : 'file_baseline',
    history:   history.rows,
  })
})

// PUT /agent/prompt — save runtime override, log to history
agentRouter.put('/agent/prompt', async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.body.workerId as string) || DEFAULT_WORKER()
  const { prompt, source = 'dashboard' } = req.body as { prompt: string; source?: string }
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' })

  await pool.query(
    `UPDATE workers SET runtime_prompt = $1 WHERE id = $2`,
    [prompt.trim(), workerId]
  )
  await pool.query(
    `INSERT INTO prompt_history (tenant_id, worker_id, prompt, source, saved_by)
     VALUES ($1, $2, $3, $4, 'human')`,
    [tenantId, workerId, prompt.trim(), source]
  )
  await audit({ tenantId, action: 'prompt_updated', actor: 'human', target: workerId, metadata: { source, length: prompt.length } })

  res.json({ ok: true })
})

// POST /agent/prompt/reset — clear runtime override, revert to file baseline
agentRouter.post('/agent/prompt/reset', async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.body.workerId as string) || DEFAULT_WORKER()

  await pool.query(`UPDATE workers SET runtime_prompt = NULL WHERE id = $1`, [workerId])
  await audit({ tenantId, action: 'prompt_reset_to_baseline', actor: 'human', target: workerId })

  res.json({ ok: true, active: null, source: 'file_baseline' })
})

// POST /agent/prompt/rollback/:historyId — restore a previous version
agentRouter.post('/agent/prompt/rollback/:historyId', async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.body.workerId as string) || DEFAULT_WORKER()

  const hist = await pool.query(
    `SELECT prompt FROM prompt_history WHERE id = $1`, [req.params.historyId]
  )
  if (!hist.rows[0]) return res.status(404).json({ error: 'History entry not found' })

  const prompt = hist.rows[0].prompt
  await pool.query(`UPDATE workers SET runtime_prompt = $1 WHERE id = $2`, [prompt, workerId])
  await pool.query(
    `INSERT INTO prompt_history (tenant_id, worker_id, prompt, source, saved_by)
     VALUES ($1, $2, $3, 'rollback', 'human')`,
    [tenantId, workerId, prompt]
  )
  await audit({ tenantId, action: 'prompt_rolled_back', actor: 'human', target: workerId, metadata: { history_id: req.params.historyId } })

  res.json({ ok: true, prompt })
})

// GET /agent/memory
agentRouter.get('/agent/memory', async (req, res) => {
  const tenantId = (req.query.tenantId as string) || DEFAULT_TENANT()
  const result = await pool.query(
    `SELECT key, value FROM business_memory WHERE tenant_id = $1 ORDER BY key`,
    [tenantId]
  )
  res.json({ memory: result.rows })
})

// PUT /agent/memory
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

// DELETE /agent/memory/:key
agentRouter.delete('/agent/memory/:key', async (req, res) => {
  const tenantId = (req.query.tenantId as string) || DEFAULT_TENANT()
  await pool.query(
    `DELETE FROM business_memory WHERE tenant_id = $1 AND key = $2`,
    [tenantId, req.params.key]
  )
  await audit({ tenantId, action: 'memory_deleted', actor: 'human', target: req.params.key })
  res.json({ ok: true })
})
