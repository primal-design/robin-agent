import { Router } from 'express'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../db/pool.js'
import { audit } from '../services/audit.js'
import { requireAuth, requireEditor, assertTenantAccess } from '../lib/auth.js'
import { tenantCanAccess } from '../services/policy.js'
import { getTenantLimits } from '../services/tenantLimits.js'

export const agentRouter = Router()

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_TENANT = () => process.env.DEFAULT_TENANT_ID ?? ''
const DEFAULT_WORKER = () => process.env.DEFAULT_WORKER_ID ?? ''

function loadFile(name: string): string {
  try {
    return readFileSync(resolve(__dirname, `../workers/${name}`), 'utf-8').trim()
  } catch { return '' }
}

function loadFilePrompt(): string {
  const soul    = loadFile('fen.soul.md')
  const runtime = loadFile('fen.prompt.md')
  return [soul, runtime].filter(Boolean).join('\n\n---\n\n')
}

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

// Verify the requested workerId belongs to the given tenant; return 404 on mismatch
// to avoid leaking existence of other tenants' resources.
async function assertWorkerOwnership(res: any, tenantId: string, workerId: string): Promise<boolean> {
  const result = await tenantCanAccess(tenantId, 'worker', workerId)
  if (result.decision === 'deny') {
    res.status(404).json({ error: 'not_found' })
    return false
  }
  return true
}

// GET /agent/prompt
agentRouter.get('/agent/prompt', requireAuth, async (req, res) => {
  const workerId = (req.query.workerId as string) || DEFAULT_WORKER()
  const tenantId = (req.query.tenantId as string) || DEFAULT_TENANT()

  if (!await assertWorkerOwnership(res, tenantId, workerId)) return

  const workerRes = await pool.query(
    `SELECT runtime_prompt_override,
            runtime_prompt_override_updated_at,
            runtime_prompt_override_updated_by
     FROM workers WHERE id = $1 AND tenant_id = $2`,
    [workerId, tenantId]
  )
  const history = await pool.query(
    `SELECT id, action, source, saved_by, created_at,
            LEFT(COALESCE(new_prompt, old_prompt, ''), 120) AS preview,
            diff
     FROM prompt_history
     WHERE worker_id = $1 AND tenant_id = $2
     ORDER BY created_at DESC LIMIT 20`,
    [workerId, tenantId]
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
agentRouter.put('/agent/prompt', requireEditor, async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.body.workerId as string) || DEFAULT_WORKER()
  const { prompt, source = 'dashboard' } = req.body as { prompt: string; source?: string }
  const savedBy = req.actor!.phone

  if (!prompt?.trim()) return res.status(400).json({ error: 'prompt required' })
  if (!await assertWorkerOwnership(res, tenantId, workerId)) return

  const oldPrompt = await getCurrentOverride(workerId)

  await pool.query(
    `UPDATE workers
     SET runtime_prompt_override            = $1,
         runtime_prompt_override_updated_at = now(),
         runtime_prompt_override_updated_by = $2
     WHERE id = $3 AND tenant_id = $4`,
    [prompt.trim(), savedBy, workerId, tenantId]
  )
  await writeHistory({ tenantId, workerId, oldPrompt, newPrompt: prompt.trim(), action: 'save', source: source as 'dashboard', savedBy })
  await audit({ tenantId, action: 'prompt_updated', actor: savedBy, target: workerId, metadata: { source, length: prompt.length } })

  res.json({ ok: true })
})

// POST /agent/prompt/reset — clear override, revert to repo baseline
agentRouter.post('/agent/prompt/reset', requireEditor, async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.body.workerId as string) || DEFAULT_WORKER()
  const savedBy  = req.actor!.phone

  if (!await assertWorkerOwnership(res, tenantId, workerId)) return

  const oldPrompt = await getCurrentOverride(workerId)

  await pool.query(
    `UPDATE workers
     SET runtime_prompt_override            = NULL,
         runtime_prompt_override_updated_at = now(),
         runtime_prompt_override_updated_by = $1
     WHERE id = $2 AND tenant_id = $3`,
    [savedBy, workerId, tenantId]
  )
  await writeHistory({ tenantId, workerId, oldPrompt, newPrompt: null, action: 'clear_override', source: 'repo_baseline', savedBy })
  await audit({ tenantId, action: 'prompt_reset_to_baseline', actor: savedBy, target: workerId })

  res.json({ ok: true, source: 'repo_baseline' })
})

// POST /agent/prompt/rollback/:historyId — restore a previous version
agentRouter.post('/agent/prompt/rollback/:historyId', requireEditor, async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const workerId = (req.body.workerId as string) || DEFAULT_WORKER()
  const savedBy  = req.actor!.phone

  if (!await assertWorkerOwnership(res, tenantId, workerId)) return

  // Verify history entry belongs to this tenant's worker
  const hist = await pool.query(
    `SELECT new_prompt, old_prompt FROM prompt_history
     WHERE id = $1 AND tenant_id = $2 AND worker_id = $3`,
    [req.params.historyId, tenantId, workerId]
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
     WHERE id = $3 AND tenant_id = $4`,
    [restorePrompt, savedBy, workerId, tenantId]
  )
  await writeHistory({ tenantId, workerId, oldPrompt, newPrompt: restorePrompt, action: 'rollback', source: 'rollback', savedBy })
  await audit({ tenantId, action: 'prompt_rolled_back', actor: savedBy, target: workerId, metadata: { history_id: req.params.historyId } })

  res.json({ ok: true, prompt: restorePrompt })
})

// GET /agent/memory
agentRouter.get('/agent/memory', requireAuth, async (req, res) => {
  const tenantId = (req.query.tenantId as string) || DEFAULT_TENANT()
  const result = await pool.query(
    `SELECT key, value FROM business_memory WHERE tenant_id = $1 ORDER BY key`, [tenantId]
  )
  res.json({ memory: result.rows })
})

// PUT /agent/memory
agentRouter.put('/agent/memory', requireEditor, async (req, res) => {
  const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
  const { key, value } = req.body as { key: string; value: string }
  if (!key?.trim()) return res.status(400).json({ error: 'key required' })
  await pool.query(
    `INSERT INTO business_memory (tenant_id, key, value) VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id, key) DO UPDATE SET value = $3`,
    [tenantId, key.trim(), value ?? '']
  )
  await audit({ tenantId, action: 'memory_updated', actor: req.actor!.phone, target: key })
  res.json({ ok: true })
})

// DELETE /agent/memory/:key
agentRouter.delete('/agent/memory/:key', requireEditor, async (req, res) => {
  const tenantId = (req.query.tenantId as string) || DEFAULT_TENANT()
  // Verify key belongs to this tenant before deleting
  const result = await tenantCanAccess(tenantId, 'business_memory', req.params.key)
  if (result.decision === 'deny') return res.status(404).json({ error: 'not_found' })

  await pool.query(
    `DELETE FROM business_memory WHERE tenant_id = $1 AND key = $2`, [tenantId, req.params.key]
  )
  await audit({ tenantId, action: 'memory_deleted', actor: req.actor!.phone, target: req.params.key })
  res.json({ ok: true })
})

// GET /workers — list workers for the authenticated user's tenant.
// Tenant is derived from session (users+memberships) with a fallback to DEFAULT_TENANT
// for single-tenant setups where memberships may not yet be populated.
// If ?tenantId= is supplied it is verified against the actor's memberships before use.
agentRouter.get('/workers', requireEditor, async (req, res) => {
  const phone = req.actor!.phone

  // Look up tenant memberships for this actor
  const memberRes = await pool.query<{ tenant_id: string }>(
    `SELECT m.tenant_id
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE u.phone_e164 = $1
     LIMIT 10`,
    [phone]
  )
  const memberTenants = memberRes.rows.map(r => r.tenant_id)

  const requestedTenantId = req.query.tenantId as string | undefined
  let tenantId: string

  if (requestedTenantId) {
    // Only allow if the actor is explicitly a member of the requested tenant,
    // OR it matches DEFAULT_TENANT (backwards-compat for single-tenant setups
    // where the memberships table is not yet populated).
    const isMember = memberTenants.includes(requestedTenantId)
    const isDefault = requestedTenantId === DEFAULT_TENANT()
    if (!isMember && !isDefault) {
      return res.status(403).json({ error: 'tenant_access_denied' })
    }
    tenantId = requestedTenantId
  } else if (memberTenants.length > 0) {
    tenantId = memberTenants[0]
  } else {
    // Single-tenant fallback: authenticated editor with no membership rows
    // is assumed to belong to the platform default tenant
    tenantId = DEFAULT_TENANT()
  }

  // Return richer worker data so the dashboard Workers page can render without extra round-trips
  const r = await pool.query(
    `SELECT w.id, w.name, w.status, w.created_at,
            w.runtime_prompt_override IS NOT NULL AS has_prompt_override,
            w.runtime_prompt_override_updated_at,
            COALESCE(
              (SELECT COUNT(*) FROM scheduled_jobs sj WHERE sj.worker_id = w.id AND sj.enabled = true),
              0
            ) AS active_jobs,
            COALESCE(
              (SELECT started_at FROM job_runs jr WHERE jr.tenant_id = w.tenant_id
               ORDER BY jr.started_at DESC LIMIT 1),
              NULL
            ) AS last_run_at
     FROM workers w
     WHERE w.tenant_id = $1
     ORDER BY w.created_at LIMIT 10`,
    [tenantId]
  )
  res.json(r.rows)
})

// GET /settings/limits — tenant limits + current usage for the Settings page
agentRouter.get('/settings/limits', requireEditor, async (req, res) => {
  const phone = req.actor!.phone

  const memberRes = await pool.query<{ tenant_id: string }>(
    `SELECT m.tenant_id FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE u.phone_e164 = $1 LIMIT 1`,
    [phone]
  )
  const tenantId = memberRes.rows[0]?.tenant_id ?? DEFAULT_TENANT()

  const requestedTenantId = req.query.tenantId as string | undefined
  if (requestedTenantId && requestedTenantId !== tenantId) {
    const ok = await assertTenantAccess(phone, requestedTenantId)
    if (!ok) return res.status(403).json({ error: 'tenant_access_denied' })
  }
  const resolvedTenant = requestedTenantId ?? tenantId

  const [limits, dailyRes, concurrentRes, jobCountRes] = await Promise.all([
    getTenantLimits(resolvedTenant),
    pool.query<{ runs_today: string }>(
      `SELECT COUNT(*) AS runs_today FROM job_runs
       WHERE tenant_id=$1 AND started_at >= CURRENT_DATE AND status != 'failed'`,
      [resolvedTenant]
    ),
    pool.query<{ running: string }>(
      `SELECT COUNT(*) AS running FROM job_runs
       WHERE tenant_id=$1 AND status IN ('queued','running')`,
      [resolvedTenant]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM scheduled_jobs WHERE tenant_id=$1 AND enabled=true`,
      [resolvedTenant]
    ),
  ])

  res.json({
    limits,
    usage: {
      runs_today:       parseInt(dailyRes.rows[0]?.runs_today ?? '0', 10),
      concurrent_runs:  parseInt(concurrentRes.rows[0]?.running ?? '0', 10),
      scheduled_jobs:   parseInt(jobCountRes.rows[0]?.count ?? '0', 10),
    },
  })
})
