import Anthropic from '@anthropic-ai/sdk'
import type { PoolClient } from 'pg'
import { checkPermission } from './permissions.js'
import { createApproval } from '../services/approvals.js'
import type { WorkerManifest } from '../workers/manifestTypes.js'
import { env } from '../config/env.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

export interface AgentTurnInput {
  client: PoolClient
  tenantId: string
  workerId: string
  conversationId: string
  inboundText: string
}

export async function runAgentTurn(input: AgentTurnInput) {
  const { client, tenantId, workerId, conversationId, inboundText } = input

  const workerRes = await client.query(
    'SELECT * FROM workers WHERE id = $1',
    [workerId]
  )
  if (!workerRes.rows[0]) throw new Error(`Worker ${workerId} not found`)

  const manifest = workerRes.rows[0].manifest as WorkerManifest

  const memoryRes = await client.query(
    'SELECT key, value FROM business_memory'
  )
  const memory: Record<string, string> = Object.fromEntries(
    memoryRes.rows.map((r: { key: string; value: string }) => [r.key, r.value])
  )

  const systemPrompt = manifest.prompt.system.replace(
    '{{business_name}}',
    memory.business_name ?? 'the business'
  )

  const historyRes = await client.query(
    `SELECT direction, content FROM messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT 10`,
    [conversationId]
  )

  const history = historyRes.rows
    .reverse()
    .map((r: { direction: string; content: string }) => ({
      role: r.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
      content: r.content,
    }))

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 700,
    system: systemPrompt,
    messages: [...history, { role: 'user', content: inboundText }],
  })

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n')

  const permission = checkPermission('send_message', manifest)

  if (permission === 'blocked') {
    return { status: 'blocked' as const, message: 'This action requires a human.' }
  }

  if (permission === 'needs_approval') {
    return createApproval({
      client,
      tenantId,
      workerId,
      conversationId,
      actionType: 'send_message',
      actionPayload: { message: text },
      proposedMessage: text,
    })
  }

  return { status: 'sent' as const, message: text }
}
