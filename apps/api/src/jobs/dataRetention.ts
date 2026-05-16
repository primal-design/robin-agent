import { pool } from '../db/pool.js'
import { audit } from '../services/audit.js'

const RETENTION_DAYS = 90

export async function runDataRetention(): Promise<void> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS)

  // Find conversations with no messages newer than the cutoff
  const old = await pool.query(
    `SELECT c.id, c.tenant_id FROM conversations c
     WHERE NOT EXISTS (
       SELECT 1 FROM messages m
       WHERE m.conversation_id = c.id AND m.created_at > $1
     ) AND c.created_at < $1`,
    [cutoff]
  )

  let deleted = 0
  for (const row of old.rows) {
    await pool.query(`DELETE FROM messages   WHERE conversation_id = $1 AND tenant_id = $2`, [row.id, row.tenant_id])
    await pool.query(`DELETE FROM approvals  WHERE conversation_id = $1 AND tenant_id = $2`, [row.id, row.tenant_id])
    await pool.query(`DELETE FROM conversations WHERE id = $1 AND tenant_id = $2`,           [row.id, row.tenant_id])
    deleted++
  }

  // Purge audit_log entries older than 1 year
  await pool.query(`DELETE FROM audit_log WHERE created_at < now() - interval '1 year'`)

  await audit({ action: 'data_retention_run', actor: 'system', metadata: { conversations_deleted: deleted, cutoff_days: RETENTION_DAYS } })

  if (deleted > 0) console.log(`[retention] Deleted ${deleted} conversations older than ${RETENTION_DAYS} days`)
}
