import type { PoolClient } from 'pg'
import { pool } from '../db/pool.js'
import {
  evaluateRisk,
  extractMetadata,
  isKnownPattern,
  isRejectedPattern,
  decidePermission,
  type RiskLevel,
  type PermissionDecision,
} from '../runtime/trust.js'

export type PolicyDecision = 'allow' | 'deny' | 'needs_approval' | 'auto_with_notify'

export interface PolicyResult {
  decision: PolicyDecision
  reason: string
}

// ── Tenant access ──────────────────────────────────────────────────────────────
// Verify that a resource belongs to the given tenant. Returns deny if the
// resource does not exist under that tenant (caller should return 404, not 403,
// to avoid leaking resource existence).

export async function tenantCanAccess(
  tenantId: string,
  resource: 'worker' | 'conversation' | 'business_memory',
  resourceId: string,
  client?: PoolClient
): Promise<PolicyResult> {
  const db = client ?? pool
  let row: { count: string } | undefined

  if (resource === 'worker') {
    const r = await db.query(`SELECT COUNT(*) FROM workers WHERE id=$1 AND tenant_id=$2`, [resourceId, tenantId])
    row = r.rows[0]
  } else if (resource === 'conversation') {
    const r = await db.query(`SELECT COUNT(*) FROM conversations WHERE id=$1 AND tenant_id=$2`, [resourceId, tenantId])
    row = r.rows[0]
  } else if (resource === 'business_memory') {
    const r = await db.query(`SELECT COUNT(*) FROM business_memory WHERE key=$1 AND tenant_id=$2`, [resourceId, tenantId])
    row = r.rows[0]
  }

  if (!row || Number(row.count) === 0) return { decision: 'deny', reason: 'resource_not_found_for_tenant' }
  return { decision: 'allow', reason: 'tenant_owns_resource' }
}

// ── Memory use ─────────────────────────────────────────────────────────────────
// Decides whether a memory item can be injected into the active prompt.
// Currently allows all business memory for the correct tenant.
// Extend here to add sensitivity tags, purpose limits, or consent checks.

export function memoryCanUse(
  item: { key: string; value: string; tenant_id?: string },
  tenantId: string
): PolicyResult {
  if (item.tenant_id && item.tenant_id !== tenantId) {
    return { decision: 'deny', reason: 'memory_belongs_to_different_tenant' }
  }
  // Future: check item.sensitivity_tag, legal basis, consent status
  return { decision: 'allow', reason: 'business_memory_allowed' }
}

// ── Action approval ─────────────────────────────────────────────────────────────
// Single entry point replacing direct trust.ts calls. All action routing
// decisions must come through here so governance is never scattered.

export async function actionNeedsApproval(
  client: PoolClient,
  tenantId: string,
  actionType: string,
  proposedText: string,
  isFirstMessage: boolean
): Promise<{ permission: PermissionDecision; risk: RiskLevel; confidence: number; reason: string }> {
  const metadata    = extractMetadata(proposedText, isFirstMessage)
  const risk        = evaluateRisk(actionType, metadata)
  const knownPat    = await isKnownPattern(client, tenantId, actionType, proposedText)
  const rejectedPat = await isRejectedPattern(client, tenantId, actionType, proposedText)
  const confidence  = 0.7  // default when not provided; pass actual value when available
  const { permission, reason } = decidePermission({ confidence, risk, knownPattern: knownPat, rejectedPattern: rejectedPat })
  return { permission, risk, confidence, reason }
}

// Overload accepting explicit confidence from the LLM response
export async function actionNeedsApprovalWithConfidence(
  client: PoolClient,
  tenantId: string,
  actionType: string,
  proposedText: string,
  isFirstMessage: boolean,
  confidence: number
): Promise<{ permission: PermissionDecision; risk: RiskLevel; confidence: number; reason: string }> {
  const metadata    = extractMetadata(proposedText, isFirstMessage)
  const risk        = evaluateRisk(actionType, metadata)
  const knownPat    = await isKnownPattern(client, tenantId, actionType, proposedText)
  const rejectedPat = await isRejectedPattern(client, tenantId, actionType, proposedText)
  const { permission, reason } = decidePermission({ confidence, risk, knownPattern: knownPat, rejectedPattern: rejectedPat })
  return { permission, risk, confidence, reason }
}

// ── Log recording ───────────────────────────────────────────────────────────────
// Decides whether an event should be recorded to the audit log.
// All events are recorded by default; extend here to sample or redact.

export function logShouldRecord(
  action: string,
  _tenantId: string
): { record: boolean; redact: boolean } {
  // Sensitive actions always recorded; high-volume debug events could be sampled later
  const alwaysRecord = ['prompt_updated', 'prompt_reset_to_baseline', 'prompt_rolled_back',
    'memory_updated', 'memory_deleted', 'approval_approved', 'approval_rejected',
    'agent_called', 'trust_decision_made']
  if (alwaysRecord.includes(action)) return { record: true, redact: false }
  return { record: true, redact: false }
}
