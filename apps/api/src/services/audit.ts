import { pool } from '../db/pool.js'
import type { PoolClient } from 'pg'

interface AuditParams {
  tenantId?: string
  actor?: string
  action: string
  target?: string
  metadata?: Record<string, unknown>
  client?: PoolClient
}

export async function audit(params: AuditParams): Promise<void> {
  const { tenantId, actor = 'system', action, target, metadata, client } = params
  const db = client ?? pool
  await db.query(
    `INSERT INTO audit_log (tenant_id, actor, action, target, metadata)
     VALUES ($1, $2, $3, $4, $5)`,
    [tenantId ?? null, actor, action, target ?? null, metadata ? JSON.stringify(metadata) : null]
  ).catch((err) => {
    // Never let audit failures crash the main flow
    console.error('[audit] failed to write:', action, err.message)
  })
}
