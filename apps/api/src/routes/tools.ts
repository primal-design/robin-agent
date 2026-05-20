import { Router } from 'express'
import { pool } from '../db/pool.js'
import { audit } from '../services/audit.js'
import { requireAuth, requireEditor } from '../lib/auth.js'

const router = Router()

const DEFAULT_TENANT = () => process.env.DEFAULT_TENANT_ID ?? ''
const DEFAULT_WORKER = () => process.env.DEFAULT_WORKER_ID ?? ''

// GET /tools — list all available tools in the registry
router.get('/tools', requireAuth, async (_req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, description, side_effect, personal_data,
              reversibility, default_approval, enabled
       FROM tools ORDER BY name`
    )
    res.json({ tools: result.rows })
  } catch (err) { next(err) }
})

// GET /tools/worker — list tools enabled for a worker
router.get('/tools/worker', requireAuth, async (req, res, next) => {
  try {
    const workerId = (req.query.workerId as string) || DEFAULT_WORKER()
    const result = await pool.query(
      `SELECT t.id, t.name, t.description, t.side_effect, t.personal_data,
              t.reversibility, t.default_approval, wt.enabled
       FROM tools t
       LEFT JOIN worker_tools wt ON wt.tool_id = t.id AND wt.worker_id = $1
       ORDER BY t.name`,
      [workerId]
    )
    res.json({ tools: result.rows })
  } catch (err) { next(err) }
})

// PUT /tools/worker/:toolId — enable or disable a tool for a worker
router.put('/tools/worker/:toolId', requireEditor, async (req, res, next) => {
  try {
    const tenantId = (req.body.tenantId as string) || DEFAULT_TENANT()
    const workerId = (req.body.workerId as string) || DEFAULT_WORKER()
    const enabled  = req.body.enabled !== false

    await pool.query(
      `INSERT INTO worker_tools (worker_id, tool_id, enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (worker_id, tool_id) DO UPDATE SET enabled = $3`,
      [workerId, req.params.toolId, enabled]
    )
    await audit({
      tenantId, action: 'tool_allowlist_updated', actor: req.actor!.phone,
      target: req.params.toolId, metadata: { workerId, enabled },
    })
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// GET /tools/citations — recent citations for a conversation
router.get('/tools/citations', requireAuth, async (req, res, next) => {
  try {
    const conversationId = req.query.conversationId as string
    if (!conversationId) return res.status(400).json({ error: 'conversationId required' })
    const result = await pool.query(
      `SELECT id, tool_id, title, url, snippet, created_at
       FROM citations
       WHERE conversation_id = $1
       ORDER BY created_at DESC LIMIT 20`,
      [conversationId]
    )
    res.json({ citations: result.rows })
  } catch (err) { next(err) }
})

export default router
