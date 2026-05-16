import { Router } from 'express'
import { pool } from '../db/pool.js'
import { audit } from '../services/audit.js'

export const approvalsRouter = Router()

// GET /approvals?tenantId=xxx — list pending approvals
approvalsRouter.get('/approvals', async (req, res) => {
  const tenantId = (req.query.tenantId as string) || process.env.DEFAULT_TENANT_ID
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const result = await pool.query(
    `SELECT a.id, a.action_type, a.proposed_message, a.action_payload, a.status, a.created_at,
            c.external_user_id, c.channel
     FROM approvals a
     LEFT JOIN conversations c ON c.id = a.conversation_id
     WHERE a.tenant_id = $1 AND a.status = 'pending'
     ORDER BY a.created_at DESC`,
    [tenantId]
  )

  res.json({ approvals: result.rows })
})

// POST /approvals/bulk-approve — approve all pending approvals for a tenant
approvalsRouter.post('/approvals/bulk-approve', async (req, res) => {
  const tenantId = (req.body.tenantId as string) || process.env.DEFAULT_TENANT_ID
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const pending = await pool.query(
    `SELECT a.*, c.external_user_id FROM approvals a
     LEFT JOIN conversations c ON c.id = a.conversation_id
     WHERE a.tenant_id = $1 AND a.status = 'pending'`,
    [tenantId]
  )

  const results: { id: string; ok: boolean }[] = []
  for (const approval of pending.rows) {
    await pool.query(
      `UPDATE approvals SET status = 'approved' WHERE id = $1 AND tenant_id = $2`,
      [approval.id, tenantId]
    )
    if (approval.external_user_id && approval.proposed_message) {
      await pool.query(
        `INSERT INTO messages (tenant_id, conversation_id, direction, content)
         VALUES ($1, $2, 'outbound', $3)`,
        [tenantId, approval.conversation_id, approval.proposed_message]
      )
      await sendTelegram(Number(approval.external_user_id), approval.proposed_message)
    }
    results.push({ id: approval.id, ok: true })
  }

  res.json({ ok: true, approved: results.length, results })
})

// POST /approvals/:id/approve — approve and send
approvalsRouter.post('/approvals/:id/approve', async (req, res) => {
  const { id } = req.params
  const tenantId = (req.body.tenantId as string) || process.env.DEFAULT_TENANT_ID

  const result = await pool.query(
    `UPDATE approvals SET status = 'approved' WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId]
  )

  if (!result.rows[0]) return res.status(404).json({ error: 'Approval not found' })

  const approval = result.rows[0]

  // Send the approved message via Telegram
  const convRes = await pool.query(
    `SELECT external_user_id FROM conversations WHERE id = $1`,
    [approval.conversation_id]
  )

  await audit({ tenantId, action: 'approval_approved', actor: 'human', target: id, metadata: { conversation_id: approval.conversation_id } })

  if (convRes.rows[0] && approval.proposed_message) {
    const chatId = convRes.rows[0].external_user_id
    await pool.query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, content)
       VALUES ($1, $2, 'outbound', $3)`,
      [tenantId, approval.conversation_id, approval.proposed_message]
    )
    await sendTelegram(Number(chatId), approval.proposed_message)
    await audit({ tenantId, action: 'message_sent', actor: 'human', target: approval.conversation_id, metadata: { channel: 'telegram', chat_id: convRes.rows[0].external_user_id } })
  }

  res.json({ ok: true, approval: result.rows[0] })
})

// POST /approvals/:id/reject
approvalsRouter.post('/approvals/:id/reject', async (req, res) => {
  const { id } = req.params
  const tenantId = (req.body.tenantId as string) || process.env.DEFAULT_TENANT_ID

  const result = await pool.query(
    `UPDATE approvals SET status = 'rejected' WHERE id = $1 AND tenant_id = $2 RETURNING *`,
    [id, tenantId]
  )

  if (!result.rows[0]) return res.status(404).json({ error: 'Approval not found' })
  await audit({ tenantId, action: 'approval_rejected', actor: 'human', target: id, metadata: { conversation_id: result.rows[0].conversation_id } })
  res.json({ ok: true })
})

// GET /my-data/:conversationId — GDPR Article 20 data export
approvalsRouter.get('/my-data/:conversationId', async (req, res) => {
  const { conversationId } = req.params
  const tenantId = (req.query.tenantId as string) || process.env.DEFAULT_TENANT_ID
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const [messages, conv] = await Promise.all([
    pool.query(
      `SELECT direction, content, created_at FROM messages
       WHERE conversation_id = $1 AND tenant_id = $2 ORDER BY created_at ASC`,
      [conversationId, tenantId]
    ),
    pool.query(
      `SELECT external_user_id, channel, created_at FROM conversations WHERE id = $1 AND tenant_id = $2`,
      [conversationId, tenantId]
    ),
  ])

  if (!conv.rows[0]) return res.status(404).json({ error: 'Conversation not found' })

  res.json({
    exported_at:  new Date().toISOString(),
    gdpr_basis:   'Article 20 — Right to data portability',
    conversation: { id: conversationId, channel: conv.rows[0].channel, started: conv.rows[0].created_at },
    messages:     messages.rows,
  })
})

async function sendTelegram(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
}
