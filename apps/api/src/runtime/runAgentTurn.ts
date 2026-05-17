import Anthropic from '@anthropic-ai/sdk'
import type { PoolClient } from 'pg'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createApproval } from '../services/approvals.js'
import { evaluateRisk, extractMetadata, isKnownPattern, isRejectedPattern, decidePermission } from './trust.js'
import type { WorkerManifest } from '../workers/manifestTypes.js'
import { env } from '../config/env.js'
import { audit } from '../services/audit.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load base prompt from file — edit fen.prompt.md and redeploy, no SQL needed
function loadFilePrompt(): string {
  try {
    return readFileSync(resolve(__dirname, '../workers/fen.prompt.md'), 'utf-8').trim()
  } catch {
    return ''
  }
}

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
  const runtimeOverride = workerRes.rows[0].runtime_prompt_override as string | null

  const memoryRes = await client.query('SELECT key, value FROM business_memory')
  const memory: Record<string, string> = Object.fromEntries(
    memoryRes.rows.map((r: { key: string; value: string }) => [r.key, r.value])
  )

  // Prompt hierarchy (explicit, unambiguous):
  //   1. runtime_prompt_override (non-empty) — dashboard override
  //   2. fen.prompt.md file                 — repo baseline default
  //   3. manifest.prompt.system             — legacy fallback only
  const filePrompt   = loadFilePrompt()
  const activePrompt = (runtimeOverride && runtimeOverride.trim().length > 0)
    ? runtimeOverride
    : (filePrompt || manifest.prompt.system)

  let systemPrompt = activePrompt
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

  await audit({ tenantId, action: 'agent_called', actor: 'runtime', target: conversationId, metadata: { model: 'claude-haiku-4-5-20251001', history_length: history.length }, client })

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
  const confMatch = raw.match(/CONFIDENCE:\s*([\d.]+)/i)
  const confidence = confMatch ? parseFloat(confMatch[1]) : 0.7
  const text = raw.replace(/\n?CONFIDENCE:\s*[\d.]+/i, '').trim()

  // Run trust engine
  const metadata       = extractMetadata(text, isFirstMessage)
  const risk           = evaluateRisk('send_message', metadata)
  const knownPat       = await isKnownPattern(client, tenantId, 'send_message', text)
  const rejectedPat    = await isRejectedPattern(client, tenantId, 'send_message', text)
  const { permission, reason } = decidePermission({ confidence, risk, knownPattern: knownPat, rejectedPattern: rejectedPat })

  await audit({ tenantId, action: 'trust_decision_made', actor: 'runtime', target: conversationId, metadata: { confidence, risk, knownPat, rejectedPat, permission, reason }, client })

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
