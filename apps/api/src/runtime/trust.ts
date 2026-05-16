import type { PoolClient } from 'pg'

export type RiskLevel    = 'low' | 'medium' | 'high'
export type PermissionDecision = 'auto_allowed' | 'auto_with_notify' | 'needs_approval'

export interface ActionMetadata {
  containsPricing:   boolean
  containsBooking:   boolean
  containsPersonalData: boolean
  isFirstMessage:    boolean
  messageLength:     number
}

// ── 1. Risk evaluation ────────────────────────────────────────────────────

export function evaluateRisk(actionType: string, metadata: ActionMetadata): RiskLevel {
  if (
    actionType === 'take_payment'     ||
    actionType === 'delete_customer_data' ||
    actionType === 'legal_advice'     ||
    metadata.containsPersonalData
  ) return 'high'

  if (
    metadata.containsPricing ||
    metadata.containsBooking ||
    actionType === 'book_appointment'
  ) return 'medium'

  if (metadata.isFirstMessage) return 'medium'

  return 'low'
}

// ── 2. Pattern matching ───────────────────────────────────────────────────

export async function isKnownPattern(
  client: PoolClient,
  tenantId: string,
  actionType: string,
  proposedMessage: string,
  threshold = 3
): Promise<boolean> {
  // Exact match first
  const exact = await client.query(
    `SELECT COUNT(*) FROM approvals
     WHERE tenant_id    = $1
       AND action_type  = $2
       AND status       = 'approved'
       AND proposed_message = $3`,
    [tenantId, actionType, proposedMessage]
  )
  if (Number(exact.rows[0].count) >= 1) return true

  // Fuzzy: same action type + same approximate length approved many times
  const pattern = await client.query(
    `SELECT COUNT(*) FROM approvals
     WHERE tenant_id   = $1
       AND action_type = $2
       AND status      = 'approved'
       AND ABS(LENGTH(proposed_message) - $3) < 80`,
    [tenantId, actionType, proposedMessage.length]
  )
  return Number(pattern.rows[0].count) >= threshold
}

// ── 3. Decision engine ────────────────────────────────────────────────────

export function decidePermission({
  confidence,
  risk,
  knownPattern,
}: {
  confidence:   number
  risk:         RiskLevel
  knownPattern: boolean
}): PermissionDecision {
  // Hard rule — high risk always needs human eyes
  if (risk === 'high') return 'needs_approval'

  // Learned pattern — trust what's been approved before
  if (knownPattern) return 'auto_allowed'

  // High confidence, low risk — auto-send
  if (confidence >= 0.85 && risk === 'low') return 'auto_allowed'

  // Good confidence, medium risk — send but notify
  if (confidence >= 0.75 && risk === 'medium') return 'auto_with_notify'

  // Default — human approval
  return 'needs_approval'
}

// ── 4. Metadata extractor ─────────────────────────────────────────────────

export function extractMetadata(
  text: string,
  isFirstMessage: boolean
): ActionMetadata {
  const lower = text.toLowerCase()
  return {
    containsPricing:     /£|\$|price|cost|fee|discount|offer|quote/i.test(lower),
    containsBooking:     /book|schedule|appointment|calendar|slot|meeting|call/i.test(lower),
    containsPersonalData:/passport|national insurance|date of birth|dob|bank|account number/i.test(lower),
    isFirstMessage,
    messageLength:       text.length,
  }
}
