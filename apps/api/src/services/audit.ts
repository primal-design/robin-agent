import { pool } from '../db/pool.js'

interface AuditParams {
  action: string
  actor: string
  tenantId?: string
  metadata?: Record<string, unknown>
}

export async function audit(params: AuditParams): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_log (action, actor, tenant_id, metadata)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [params.action, params.actor, params.tenantId ?? null, JSON.stringify(params.metadata ?? {})]
    )
  } catch {
    // audit failures are non-fatal
  }
}
