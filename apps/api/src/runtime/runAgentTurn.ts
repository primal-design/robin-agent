import Anthropic from '@anthropic-ai/sdk'
import type { PoolClient } from 'pg'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createApproval } from '../services/approvals.js'
import { evaluateRisk, extractMetadata, isKnownPattern, isRejectedPattern, decidePermission } from './trust.js'
import { getAllowedTools, toAnthropicTool } from './tools/registry.js'
import { dispatchTool } from './tools/dispatcher.js'
import { getEpisodicSummary } from '../services/episodic.js'
import type { WorkerManifest } from '../workers/manifestTypes.js'
import { env } from '../config/env.js'
import { audit } from '../services/audit.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

function loadFile(name: string): string {
  try {
    return readFileSync(resolve(__dirname, `../workers/${name}`), 'utf-8').trim()
  } catch {
    return ''
  }
}

function loadFilePrompt(): string {
  const soul    = loadFile('fen.soul.md')
  const runtime = loadFile('fen.prompt.md')
  return [soul, runtime].filter(Boolean).join('\n\n---\n\n')
}

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

const CONFIDENCE_INSTRUCTION = `\n\nAfter your reply, on a new line write exactly: CONFIDENCE:0.XX (a number between 0 and 1 representing how confident you are this reply is correct and appropriate).`

export interface AgentTurnInput {
  client:         PoolClient
  tenantId:       string
  workerId:       string
  conversationId: string
  inboundText:    string
}

export async function runAgentTurn(input: AgentTurnInput) {
  const { client, tenantId, workerId, conversationId, inboundText } = input

  const workerRes = await client.query('SELECT * FROM workers WHERE id = $1', [workerId])
  if (!workerRes.rows[0]) throw new Error(`Worker ${workerId} not found`)

  const manifest        = workerRes.rows[0].manifest as WorkerManifest
  const runtimeOverride = workerRes.rows[0].runtime_prompt_override as string | null

  // ── Memory ────────────────────────────────────────────────────────────────
  const memoryRes = await client.query(
    'SELECT key, value FROM business_memory WHERE tenant_id = $1', [tenantId]
  )
  const memory: Record<string, string> = Object.fromEntries(
    memoryRes.rows.map((r: { key: string; value: string }) => [r.key, r.value])
  )

  // ── Episodic memory ───────────────────────────────────────────────────────
  const episodicSummary = await getEpisodicSummary(client, conversationId)
  memory['episodic_summary'] = episodicSummary || '(no prior context for this conversation)'
  memory['active_goal']      = ''

  // ── Prompt assembly ───────────────────────────────────────────────────────
  // Priority: runtime_prompt_override (dashboard) → fen.soul + fen.prompt (repo) → manifest legacy
  const filePrompt   = loadFilePrompt()
  const activePrompt = (runtimeOverride && runtimeOverride.trim().length > 0)
    ? runtimeOverride
    : (filePrompt || manifest.prompt.system)

  let systemPrompt = activePrompt
  for (const [key, value] of Object.entries(memory)) {
    systemPrompt = systemPrompt.replaceAll(`{{${key}}}`, value)
  }

  // ── Conversation history ──────────────────────────────────────────────────
  const historyRes = await client.query(
    `SELECT direction, content FROM messages
     WHERE conversation_id = $1 ORDER BY created_at DESC LIMIT 20`,
    [conversationId]
  )

  const allRows = historyRes.rows.reverse() as { direction: string; content: string }[]
  const withoutCurrent = allRows.filter((r, i) =>
    !(i === allRows.length - 1 && r.direction === 'inbound' && r.content === inboundText)
  )
  let trimmed = [...withoutCurrent]
  while (trimmed.length > 0 && trimmed[trimmed.length - 1].direction === 'inbound') {
    trimmed.pop()
  }
  const history = trimmed.map((r) => ({
    role:    r.direction === 'inbound' ? ('user' as const) : ('assistant' as const),
    content: r.content,
  }))

  const isFirstMessage = history.length === 0

  // ── Tools ─────────────────────────────────────────────────────────────────
  const allowedTools   = await getAllowedTools(client, workerId)
  const anthropicTools = allowedTools.map(toAnthropicTool)
  const hasTools       = anthropicTools.length > 0

  await audit({
    tenantId, action: 'agent_called', actor: 'runtime', target: conversationId,
    metadata: { model: 'claude-haiku-4-5-20251001', history_length: history.length, tools: allowedTools.map(t => t.id) },
    client,
  })

  // ── LLM call (with optional tool loop) ───────────────────────────────────
  const userMessages: Anthropic.MessageParam[] = [
    ...history,
    { role: 'user', content: inboundText },
  ]

  const toolInstruction = hasTools
    ? `\n\nYou have access to tools. Use web_search whenever the user asks about: current events, latest tools or products, prices, news, competitors, market data, recent developments, or anything that may have changed since your training. Do not answer these from memory — search first, then answer from the results.`
    : ''

  const createParams: Anthropic.MessageCreateParamsNonStreaming = {
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system:     systemPrompt + toolInstruction + CONFIDENCE_INSTRUCTION,
    messages:   userMessages,
    ...(hasTools ? { tools: anthropicTools } : {}),
  }

  const firstResponse = await anthropic.messages.create(createParams)

  let rawText: string

  if (hasTools && firstResponse.stop_reason === 'tool_use') {
    // Execute all tool calls in parallel
    const toolUseBlocks = firstResponse.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    await audit({
      tenantId, action: 'tools_called', actor: 'runtime', target: conversationId,
      metadata: { tools: toolUseBlocks.map(b => b.name) },
      client,
    })

    const toolResults = await Promise.all(
      toolUseBlocks.map((b) =>
        dispatchTool(client, tenantId, conversationId, {
          id:    b.id,
          name:  b.name,
          input: b.input as Record<string, unknown>,
        })
      )
    )

    // Second call with tool results
    const secondResponse = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:     systemPrompt + CONFIDENCE_INSTRUCTION,
      tools:      anthropicTools,
      messages:   [
        ...userMessages,
        { role: 'assistant', content: firstResponse.content },
        {
          role: 'user',
          content: toolResults.map((r) => ({
            type:        'tool_result' as const,
            tool_use_id: r.toolUseId,
            content:     r.content,
          })),
        },
      ],
    })

    rawText = secondResponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
  } else {
    rawText = firstResponse.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
  }

  // ── Parse confidence ──────────────────────────────────────────────────────
  const confMatch = rawText.match(/CONFIDENCE:\s*([\d.]+)/i)
  const confidence = confMatch ? parseFloat(confMatch[1]) : 0.7
  const text = rawText.replace(/\n?CONFIDENCE:\s*[\d.]+/i, '').trim()

  // ── Trust engine ──────────────────────────────────────────────────────────
  const metadata       = extractMetadata(text, isFirstMessage)
  const risk           = evaluateRisk('send_message', metadata)
  const knownPat       = await isKnownPattern(client, tenantId, 'send_message', text)
  const rejectedPat    = await isRejectedPattern(client, tenantId, 'send_message', text)
  const { permission, reason } = decidePermission({ confidence, risk, knownPattern: knownPat, rejectedPattern: rejectedPat })

  await audit({
    tenantId, action: 'trust_decision_made', actor: 'runtime', target: conversationId,
    metadata: { confidence, risk, knownPat, rejectedPat, permission, reason },
    client,
  })

  if (permission === 'auto_allowed') {
    return { status: 'sent' as const, message: text, confidence, risk, reason }
  }

  if (permission === 'auto_with_notify') {
    return { status: 'sent_with_notify' as const, message: text, confidence, risk, reason }
  }

  return createApproval({
    client,
    tenantId,
    workerId,
    conversationId,
    actionType:      'send_message',
    actionPayload:   { message: text, confidence, risk, reason },
    proposedMessage: text,
  })
}
