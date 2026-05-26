import { Router } from 'express'
import { requireAuth } from '../lib/auth.js'
import { pool } from '../db/pool.js'
import { withTenant } from '../db/withTenant.js'
import { PLAYBOOKS, getPlaybook } from '../playbooks/definitions.js'

const router = Router()

async function resolveTenant(workerId: string): Promise<string | null> {
  const r = await pool.query('SELECT get_tenant_for_worker($1) AS tenant_id', [workerId])
  return r.rows[0]?.tenant_id ?? null
}

// ── List all official playbooks + install status ──────────────────────────────

router.get('/playbooks', requireAuth, async (req, res, next) => {
  try {
    const workerId = req.query.worker_id as string
    if (!workerId) return res.status(400).json({ error: 'worker_id required' })

    const tenantId = await resolveTenant(workerId)
    if (!tenantId) return res.status(404).json({ error: 'worker not found' })

    const installs = await withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT playbook_id, status, intake, installed_at, activated_at
         FROM playbook_installs WHERE tenant_id = $1 AND worker_id = $2`,
        [tenantId, workerId]
      )
      return r.rows
    })

    const installMap = new Map(installs.map((i: any) => [i.playbook_id, i]))
    const result = PLAYBOOKS.map(p => ({ ...p, install: installMap.get(p.id) ?? null }))

    res.json({ playbooks: result })
  } catch (err) { next(err) }
})

// ── Get single playbook ───────────────────────────────────────────────────────

router.get('/playbooks/:id', requireAuth, async (req, res, next) => {
  try {
    const p = getPlaybook(req.params.id)
    if (!p) return res.status(404).json({ error: 'not_found' })

    const workerId = req.query.worker_id as string
    if (!workerId) return res.json({ playbook: p, install: null })

    const tenantId = await resolveTenant(workerId)
    if (!tenantId) return res.status(404).json({ error: 'worker not found' })

    const install = await withTenant(tenantId, async (client) => {
      const r = await client.query(
        `SELECT * FROM playbook_installs WHERE tenant_id = $1 AND worker_id = $2 AND playbook_id = $3 LIMIT 1`,
        [tenantId, workerId, p.id]
      )
      return r.rows[0] ?? null
    })

    res.json({ playbook: p, install })
  } catch (err) { next(err) }
})

// ── Install a playbook ────────────────────────────────────────────────────────

router.post('/playbooks/:id/install', requireAuth, async (req, res, next) => {
  try {
    const p = getPlaybook(req.params.id)
    if (!p) return res.status(404).json({ error: 'not_found' })

    const workerId = req.body.worker_id as string
    if (!workerId) return res.status(400).json({ error: 'worker_id required' })

    const tenantId = await resolveTenant(workerId)
    if (!tenantId) return res.status(404).json({ error: 'worker not found' })

    const install = await withTenant(tenantId, async (client) => {
      const r = await client.query(`
        INSERT INTO playbook_installs (tenant_id, worker_id, playbook_id)
        VALUES ($1, $2, $3)
        ON CONFLICT (tenant_id, worker_id, playbook_id)
        DO UPDATE SET
          status = CASE WHEN playbook_installs.status = 'paused'
                        THEN 'pending_intake'
                        ELSE playbook_installs.status END
        RETURNING *
      `, [tenantId, workerId, p.id])
      return r.rows[0]
    })

    res.json({ ok: true, install, intake: p.intake })
  } catch (err) { next(err) }
})

// ── Submit intake → seed memory + create scheduled jobs → activate ────────────

router.post('/playbooks/:id/intake', requireAuth, async (req, res, next) => {
  try {
    const p = getPlaybook(req.params.id)
    if (!p) return res.status(404).json({ error: 'not_found' })

    const { worker_id, answers, output_chat_id } = req.body as {
      worker_id:      string
      answers:        Record<string, string>
      output_chat_id?: number
    }
    if (!worker_id || !answers) return res.status(400).json({ error: 'worker_id and answers required' })

    const tenantId = await resolveTenant(worker_id)
    if (!tenantId) return res.status(404).json({ error: 'worker not found' })

    await withTenant(tenantId, async (client) => {
      // Seed intake answers as memory keys
      for (const [key, value] of Object.entries(answers)) {
        if (!value) continue
        await client.query(`
          INSERT INTO business_memory_core (tenant_id, memory_key, memory_value, notes)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (tenant_id, memory_key)
          DO UPDATE SET memory_value = $3, notes = $4, updated_at = now()
        `, [tenantId, `${p.id}_${key}`, String(value), `${p.name} playbook`])
      }

      // Seed named memory keys defined in the playbook
      for (const mk of p.memoryKeys) {
        // Match by stripping common prefixes to find the intake answer
        const shortKey = mk.key.replace(/^(travel_|inbox_|meeting_|invoice_|sales_|weekly_|loop_)/, '')
        const value = answers[mk.key] ?? answers[shortKey]
        if (!value) continue
        await client.query(`
          INSERT INTO business_memory_core (tenant_id, memory_key, memory_value, notes)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (tenant_id, memory_key)
          DO UPDATE SET memory_value = $3, notes = $4, updated_at = now()
        `, [tenantId, mk.key, String(value), `${p.name} playbook`])
      }

      // Create scheduled jobs
      if (p.scheduledJobs?.length) {
        for (const jobDef of p.scheduledJobs) {
          await client.query(`
            INSERT INTO scheduled_jobs
              (tenant_id, worker_id, name, task, cron_expression, execution_mode, output_chat_id, next_run_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, now())
            ON CONFLICT DO NOTHING
          `, [
            tenantId, worker_id,
            `[${p.name}] ${jobDef.name}`,
            jobDef.task,
            jobDef.defaultCron,
            jobDef.executionMode,
            output_chat_id ?? null,
          ])
        }
      }

      // Activate
      await client.query(`
        UPDATE playbook_installs
        SET status = 'active', intake = $1, activated_at = now()
        WHERE tenant_id = $2 AND worker_id = $3 AND playbook_id = $4
      `, [JSON.stringify(answers), tenantId, worker_id, p.id])
    })

    res.json({ ok: true, status: 'active' })
  } catch (err) { next(err) }
})

// ── Pause ─────────────────────────────────────────────────────────────────────

router.delete('/playbooks/:id/install', requireAuth, async (req, res, next) => {
  try {
    const workerId = req.query.worker_id as string
    if (!workerId) return res.status(400).json({ error: 'worker_id required' })

    const tenantId = await resolveTenant(workerId)
    if (!tenantId) return res.status(404).json({ error: 'worker not found' })

    await withTenant(tenantId, async (client) => {
      await client.query(
        `UPDATE playbook_installs SET status = 'paused'
         WHERE tenant_id = $1 AND worker_id = $2 AND playbook_id = $3`,
        [tenantId, workerId, req.params.id]
      )
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

export default router
