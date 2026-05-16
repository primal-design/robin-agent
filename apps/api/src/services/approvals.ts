import type { PoolClient } from 'pg'

export interface ApprovalInput {
  client: PoolClient
  tenantId: string
  workerId: string
  conversationId: string
  actionType: string
  actionPayload: Record<string, unknown>
  proposedMessage: string
}

export interface ApprovalResult {
  status: 'needs_approval'
  approvalId: string
  proposedMessage: string
  buttons: string[]
}

export async function createApproval(input: ApprovalInput): Promise<ApprovalResult> {
  const { client, tenantId, workerId, conversationId, actionType, actionPayload, proposedMessage } = input

  const result = await client.query(
    `INSERT INTO approvals
       (tenant_id, worker_id, conversation_id, action_type, action_payload, proposed_message, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     RETURNING id`,
    [tenantId, workerId, conversationId, actionType, JSON.stringify(actionPayload), proposedMessage]
  )

  return {
    status: 'needs_approval',
    approvalId: result.rows[0].id,
    proposedMessage,
    buttons: ['Approve & Send', 'Edit', 'Reject'],
  }
}

export async function resolveApproval(
  client: PoolClient,
  approvalId: string,
  decision: 'approved' | 'rejected'
) {
  const result = await client.query(
    `UPDATE approvals SET status = $1 WHERE id = $2 RETURNING *`,
    [decision, approvalId]
  )
  return result.rows[0]
}
