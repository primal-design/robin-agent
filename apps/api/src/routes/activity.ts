import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../lib/auth.js'
import { assertTenantAccess } from '../lib/auth.js'

const router = Router()

// GET /activity?worker_id=&limit=50&before=<ISO timestamp>
// Unified feed: job_runs + business_memory_events + outbound_actions.
// Tenant is resolved from worker_id and verified against the actor's memberships.
router.get('/activity', requireAuth, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  // Resolve tenant from worker — never trust client-supplied tenant_id
  const tenantRes = await pool.query(
    'SELECT tenant_id FROM workers WHERE id=$1',
    [worker_id]
  )
  if (!tenantRes.rows[0]) return res.status(404).json({ error: 'not_found' })
  const tenantId = tenantRes.rows[0].tenant_id as string

  // Membership gate — actor must belong to this tenant
  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const limit = Math.min(parseInt(req.query.limit as string || '50', 10), 100)
  const before = req.query.before as string | undefined

  // All rows are filtered by tenant_id (even though we already verified via worker_id)
  const beforeClause = before ? `AND created_at < $3` : ''
  const params = (extra: unknown[]) =>
    before ? [tenantId, limit, ...extra] : [tenantId, limit]

  const [runsRes, eventsRes, outboundRes] = await Promise.all([
    pool.query(
      `SELECT jr.id, jr.status, jr.output, jr.error,
              jr.started_at AS created_at, jr.finished_at,
              jr.attempt_count, jr.bullmq_job_id,
              sj.name AS job_name
       FROM job_runs jr
       LEFT JOIN scheduled_jobs sj ON sj.id = jr.job_id
       WHERE jr.tenant_id = $1 ${before ? 'AND jr.started_at < $3' : ''}
       ORDER BY jr.started_at DESC LIMIT $2`,
      before ? [tenantId, limit, before] : [tenantId, limit]
    ),
    pool.query(
      `SELECT id, memory_layer, action, reason, actor_type,
              before_value, after_value, created_at
       FROM business_memory_events
       WHERE tenant_id = $1 ${before ? 'AND created_at < $3' : ''}
       ORDER BY created_at DESC LIMIT $2`,
      before ? [tenantId, limit, before] : [tenantId, limit]
    ),
    pool.query(
      `SELECT id, action_type, target_key, status,
              created_at, sent_at
       FROM outbound_actions
       WHERE tenant_id = $1 ${before ? 'AND created_at < $3' : ''}
       ORDER BY created_at DESC LIMIT $2`,
      before ? [tenantId, limit, before] : [tenantId, limit]
    ),
  ])

  const feed = [
    ...runsRes.rows.map(r  => ({ ...r, _type: 'job_run'          as const })),
    ...eventsRes.rows.map(e => ({ ...e, _type: 'memory_event'     as const })),
    ...outboundRes.rows.map(o => ({ ...o, _type: 'outbound_action' as const })),
  ]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, limit)

  const nextCursor = feed.length === limit ? feed[feed.length - 1].created_at : null

  res.json({ items: feed, next_before: nextCursor, limit })
})

export default router
