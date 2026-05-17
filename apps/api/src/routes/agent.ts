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

// Minimal line-based diff — returns a unified-style string
function simpleDiff(oldText: string | null, newText: string | null): string {
  const oldLines = (oldText ?? '').split('\n')
  const newLines = (newText ?? '').split('\n')
  const removed = oldLines.filter(l => !newLines.includes(l)).map(l => `- ${l}`)
  const added   = newLines.filter(l => !oldLines.includes(l)).map(l => `+ ${l}`)
  return [...removed, ...added].join('\n') || '(no change)'
}

async function getCurrentOverride(workerId: string): Promise<string | null> {
  const r = await pool.query(
    `SELECT runtime_prompt_override FROM workers WHERE id = $1`, [workerId]
  )
  return r.rows[0]?.runtime_prompt_override ?? null
}

async function writeHistory(params: {
  tenantId:  string
  workerId:  string
  oldPrompt: string | null
  newPrompt: string | null
  action:    'save' | 'rollback' | 'clear_override'
  source:    'dashboard' | 'repo_baseline' | 'api' | 'rollback'
  savedBy:   string
}) {
  const { tenantId, workerId, oldPrompt, newPrompt, action, source, savedBy } = params
  await pool.query(
    `INSERT INTO prompt_history
       (tenant_id, worker_id, old_prompt, new_prompt, diff, action, source, saved_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tenantId, workerId, oldPrompt, newPrompt, simpleDiff(oldPrompt, newPrompt), action, source, savedBy]
  )
}

// GET /agent/prompt
agentRouter.get('/agent/prompt', async (req, res) => {
  const workerId = (req.query.workerId as string) || DEFAULT_WORKER()
  const tenantId = (req.query.tenantId as string) || DEFAULT_TENANT()

  const workerRes = await pool.query(
    `SELECT runtime_prompt_override,
            runtime_prompt_override_updated_at,
            runtime_prompt_override_updated_by
     FROM workers WHERE id = $1`,
    [workerId]
  )
  const history = await pool.query(
    `SELECT id, action, source, saved_by, created_at,
            LEFT(COALESCE(new_prompt, old_prompt, ''), 120) AS preview,
            diff
     FROM prompt_history
     WHERE worker_id = $1
     ORDER BY created_at DESC LIMIT 20`,
    [workerId]
  )

  const override = workerRes.rows[0]?.runtime_prompt_override ?? null
  const filePrompt = loadFilePrompt()
  const isOverrideActive = override && override.trim().length > 0

  res.json({
    active:     isOverrideActive ? override : filePrompt,
    override:   override,
    baseline:   filePrompt,
    source:     isOverrideActive ? 'dashboard_override' : 'repo_baseline',
    updated_at: workerRes.rows[0]?.runtime_prompt_override_updated_at ?? null,
    updated_by: workerRes.rows[0]?.runtime_prompt_override_updated_by ?? null,
    history:    history.rows,
  })
})

// PUT /agent/prompt — save runtime override
agentRouter.put('/agent/prompt', async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.body.workerId as string) || DEFAULT_WORKER()
  const { prompt, source = 'dashboard', saved_by = 'human' } = req.body as {
    prompt: string; source?: string; saved_by?: string
  }
  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' })

  const oldPrompt = await getCurrentOverride(workerId)

  await pool.query(
    `UPDATE workers
     SET runtime_prompt_override            = $1,
         runtime_prompt_override_updated_at = now(),
         runtime_prompt_override_updated_by = $2
     WHERE id = $3`,
    [prompt.trim(), saved_by, workerId]
  )
  await writeHistory({ tenantId, workerId, oldPrompt, newPrompt: prompt.trim(), action: 'save', source: source as 'dashboard', savedBy: saved_by })
  await audit({ tenantId, action: 'prompt_updated', actor: saved_by, target: workerId, metadata: { source, length: prompt.length } })

  res.json({ ok: true })
})

// POST /agent/prompt/reset — clear override, revert to repo baseline
agentRouter.post('/agent/prompt/reset', async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.body.workerId as string) || DEFAULT_WORKER()
  const savedBy  = (req.body.saved_by as string) || 'human'

  const oldPrompt = await getCurrentOverride(workerId)

  await pool.query(
    `UPDATE workers
     SET runtime_prompt_override            = NULL,
         runtime_prompt_override_updated_at = now(),
         runtime_prompt_override_updated_by = $1
     WHERE id = $2`,
    [savedBy, workerId]
  )
  await writeHistory({ tenantId, workerId, oldPrompt, newPrompt: null, action: 'clear_override', source: 'repo_baseline', savedBy })
  await audit({ tenantId, action: 'prompt_reset_to_baseline', actor: savedBy, target: workerId })

  res.json({ ok: true, source: 'repo_baseline' })
})

// POST /agent/prompt/rollback/:historyId — restore a previous version
agentRouter.post('/agent/prompt/rollback/:historyId', async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.body.workerId as string) || DEFAULT_WORKER()
  const savedBy  = (req.body.saved_by as string) || 'human'

  const hist = await pool.query(
    `SELECT new_prompt, old_prompt FROM prompt_history WHERE id = $1`, [req.params.historyId]
  )
  if (!hist.rows[0]) return res.status(404).json({ error: 'History entry not found' })

  const restorePrompt = hist.rows[0].new_prompt ?? hist.rows[0].old_prompt
  if (!restorePrompt) return res.status(400).json({ error: 'Nothing to restore' })

  const oldPrompt = await getCurrentOverride(workerId)

  await pool.query(
    `UPDATE workers
     SET runtime_prompt_override            = $1,
         runtime_prompt_override_updated_at = now(),
         runtime_prompt_override_updated_by = $2
     WHERE id = $3`,
    [restorePrompt, savedBy, workerId]
  )
  await writeHistory({ tenantId, workerId, oldPrompt, newPrompt: restorePrompt, action: 'rollback', source: 'rollback', savedBy })
  await audit({ tenantId, action: 'prompt_rolled_back', actor: savedBy, target: workerId, metadata: { history_id: req.params.historyId } })

  res.json({ ok: true, prompt: restorePrompt })
})

// GET /agent/memory
agentRouter.get('/agent/memory', async (req, res) => {
  const tenantId = (req.query.tenantId as string) || DEFAULT_TENANT()
  const result = await pool.query(
    `SELECT key, value FROM business_memory WHERE tenant_id = $1 ORDER BY key`, [tenantId]
  )
  res.json({ memory: result.rows })
})

// PUT /agent/memory
agentRouter.put('/agent/memory', async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const { key, value } = req.body as { key: string; value: string }
  if (!key?.trim()) return res.status(400).json({ error: 'key required' })
  await pool.query(
    `INSERT INTO business_memory (tenant_id, key, value) VALUES ($1, $2, $3)
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
    `DELETE FROM business_memory WHERE tenant_id = $1 AND key = $2`, [tenantId, req.params.key]
  )
  await audit({ tenantId, action: 'memory_deleted', actor: 'human', target: req.params.key })
  res.json({ ok: true })
})
