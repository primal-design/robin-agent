import Anthropic from '@anthropic-ai/sdk'
import type { PoolClient } from 'pg'
import { createApproval } from '../services/approvals.js'
import { evaluateRisk, extractMetadata, isKnownPattern, isRejectedPattern, decidePermission } from './trust.js'
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

  const workerRes = await client.query('SELECT * FROM workers WHERE id = $1', [workerId])
  if (!workerRes.rows[0]) throw new Error(`Worker ${workerId} not found`)

  const manifest = workerRes.rows[0].manifest as WorkerManifest

  const memoryRes = await client.query('SELECT key, value FROM business_memory')
  const memory: Record<string, string> = Object.fromEntries(
    memoryRes.rows.map((r: { key: string; value: string }) => [r.key, r.value])
  )

  // Inject all memory fields into system prompt
  let systemPrompt = manifest.prompt.system
  for (const [key, value] of Object.entries(memory)) {
    systemPrompt = systemPrompt.replaceAll(`{{${key}}}`, value)
  }

  const historyRes = await client.query(
    `SELECT direction, content FROM messages
     WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [conversationId]
  )

  // Build history excluding the current inbound message (it's passed separately as inboundText)
  // and strip any trailing unanswered user messages so we don't carry stale context forward
  const allRows = historyRes.rows.reverse() as { direction: string; content: string }[]
  const withoutCurrent = allRows.filter((r, i) =>
    !(i === allRows.length - 1 && r.direction === 'inbound' && r.content === inboundText)
  )
  // Drop trailing inbound messages that have no outbound reply — they represent unanswered approvals
  let trimmed = [...withoutCurrent]
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].direction === 'inbound') {
    trimmed.pop()
  }
  const history = trimmed.map((r) => ({
    role: r.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
    content: r.content,
  }))

  const isFirstMessage = history.length === 0

  // Ask the LLM for a reply AND a confidence score
  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    system: systemPrompt + `\n\nAfter your reply, on a new line write exactly: CONFIDENCE:0.XX (a number between 0 and 1 representing how confident you are this reply is correct and appropriate).`,
    messages: [...history, { role: 'user', content: inboundText }],
  })

  const raw = response.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n')

  // Parse confidence out of response
  const confMatch = raw.match(/CONFIDENCE:(0\.\d+)/i)
  const confidence = confMatch ? parseFloat(confMatch[1]) : 0.7
  const text = raw.replace(/\nCONFIDENCE:[\d.]+/i, '').trim()

  // Run trust engine
  const metadata       = extractMetadata(text, isFirstMessage)
  const risk           = evaluateRisk('send_message', metadata)
  const knownPat       = await isKnownPattern(client, tenantId, 'send_message', text)
  const rejectedPat    = await isRejectedPattern(client, tenantId, 'send_message', text)
  const { permission, reason } = decidePermission({ confidence, risk, knownPattern: knownPat, rejectedPattern: rejectedPat })

  // Log the decision for audit
  await client.query(
    `INSERT INTO audit_log (tenant_id, actor, action, target, metadata)
     VALUES ($1, 'runtime', 'permission_decision', $2, $3)`,
    [tenantId, conversationId, JSON.stringify({ confidence, risk, knownPat, rejectedPat, permission, reason })]
  ).catch(() => {})

  if (permission === 'auto_allowed') {
    return { status: 'sent' as const, message: text, confidence, risk, reason }
  }

  if (permission === 'auto_with_notify') {
    return { status: 'sent_with_notify' as const, message: text, confidence, risk, reason }
  }

  // needs_approval — include reason so the UI can display it
  return createApproval({
    client,
    tenantId,
    workerId,
    conversationId,
    actionType: 'send_message',
    actionPayload: { message: text, confidence, risk, reason },
    proposedMessage: text,
  })
}
