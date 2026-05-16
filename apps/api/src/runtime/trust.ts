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
     WHERE tenant_id         = $1
       AND action_type       = $2
       AND status            = 'approved'
       AND proposed_message  = $3`,
    [tenantId, actionType, proposedMessage]
  )
  if (Number(exact.rows[0].count) >= 1) return true

  // Fuzzy: same action type + similar length approved multiple times
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

// ── 2b. Rejection learning ────────────────────────────────────────────────
// If a tenant has rejected this pattern before, force approval regardless of confidence

export async function isRejectedPattern(
  client: PoolClient,
  tenantId: string,
  actionType: string,
  proposedMessage: string,
  threshold = 2
): Promise<boolean> {
  const result = await client.query(
    `SELECT COUNT(*) FROM approvals
     WHERE tenant_id   = $1
       AND action_type = $2
       AND status      = 'rejected'
       AND ABS(LENGTH(proposed_message) - $3) < 60`,
    [tenantId, actionType, proposedMessage.length]
  )
  return Number(result.rows[0].count) >= threshold
}

// ── 3. Decision engine ────────────────────────────────────────────────────

export interface TrustDecision {
  permission: PermissionDecision
  reason:     string
}

export function decidePermission({
  confidence,
  risk,
  knownPattern,
  rejectedPattern,
}: {
  confidence:      number
  risk:            RiskLevel
  knownPattern:    boolean
  rejectedPattern: boolean
}): TrustDecision {
  // Rejection learning — this tenant has rejected this pattern before
  if (rejectedPattern) return {
    permission: 'needs_approval',
    reason:     'Similar messages have been rejected by this tenant before',
  }

  // Hard rule — high risk always needs human eyes
  if (risk === 'high') return {
    permission: 'needs_approval',
    reason:     'Message contains high-risk content (pricing, booking, or personal data)',
  }

  // Learned pattern — trust what's been approved before
  if (knownPattern) return {
    permission: 'auto_allowed',
    reason:     'Matches a previously approved pattern',
  }

  // Low risk — auto-send unless confidence is very low
  if (risk === 'low') {
    if (confidence >= 0.60) return {
      permission: 'auto_allowed',
      reason:     `Low risk, confidence ${Math.round(confidence * 100)}%`,
    }
    return {
      permission: 'needs_approval',
      reason:     `Low confidence (${Math.round(confidence * 100)}%) — needs human review`,
    }
  }

  // Medium risk — send with notification if reasonable confidence
  if (risk === 'medium') {
    if (confidence >= 0.65) return {
      permission: 'auto_with_notify',
      reason:     `Medium risk, confidence ${Math.round(confidence * 100)}% — sent with notification`,
    }
    return {
      permission: 'needs_approval',
      reason:     `Low confidence (${Math.round(confidence * 100)}%) on medium-risk message`,
    }
  }

  return {
    permission: 'needs_approval',
    reason:     'New pattern — needs approval to build trust',
  }
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
