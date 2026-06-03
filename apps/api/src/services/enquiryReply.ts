import Anthropic from '@anthropic-ai/sdk'
import type { PoolClient } from 'pg'
import { env } from '../config/env.js'
import { recordEnquiryEvent } from './enquiries.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

// ── getServiceAreas ───────────────────────────────────────────────────────────
// Reads service_areas from business_memory_core for the tenant.

export async function getServiceAreas(
  client: PoolClient,
  tenantId: string
): Promise<string[]> {
  const r = await client.query(
    `SELECT memory_value FROM business_memory_core
     WHERE tenant_id = $1 AND memory_key = 'service_areas' LIMIT 1`,
    [tenantId]
  )
  const raw = r.rows[0]?.memory_value
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ── getDraftReplyContext ──────────────────────────────────────────────────────
// Assembles business context for draft reply generation.

export async function getDraftReplyContext(
  client: PoolClient,
  tenantId: string
): Promise<Record<string, string>> {
  const r = await client.query(
    `SELECT memory_key, memory_value FROM business_memory_core
     WHERE tenant_id = $1`,
    [tenantId]
  )
  const ctx: Record<string, string> = {}
  for (const row of r.rows) {
    ctx[row.memory_key] = row.memory_value
  }
  return ctx
}

// ── generateDraftReply ────────────────────────────────────────────────────────
// Generates a short, professional first reply for a UK trades enquiry.

export async function generateDraftReply(
  client: PoolClient,
  params: {
    tenantId:       string
    enquiryId:      string
    customerName:   string | null
    summary:        string
    missingDetails: string[]
    urgency:        string
    businessCtx:    Record<string, string>
  }
): Promise<string> {
  const { tenantId, enquiryId, customerName, summary, missingDetails, urgency, businessCtx } = params

  const businessName = businessCtx['business_name'] ?? 'We'
  const services     = businessCtx['business_description'] ?? ''
  const tone         = businessCtx['reply_tone'] ?? 'friendly and professional'
  const doNotSay     = businessCtx['do_not_say'] ?? ''

  const firstName = customerName?.split(' ')[0] ?? null

  const prompt = `You are drafting a first reply for a UK trades business to a new customer enquiry.

Business: ${businessName}
Services: ${services}
Tone: ${tone}
${doNotSay ? `Do not say: ${doNotSay}` : ''}

Enquiry:
Customer: ${firstName ?? 'the customer'}
Summary: ${summary}
Urgency: ${urgency}
${missingDetails.length > 0 ? `Missing info: ${missingDetails.slice(0, 2).join(', ')} (ask for the most important one only)` : ''}

Rules:
- Short and direct — 2-4 sentences maximum
- Do not promise specific pricing or availability
- Do not ask more than one question
- UK English
- No emojis
- Start with "Hi ${firstName ?? 'there'}"

Write the reply only. No preamble.`

  const started = Date.now()
  let output = ''
  let inputTokens = 0
  let outputTokens = 0
  let success = true
  let error = ''

  try {
    const res = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages:   [{ role: 'user', content: prompt }],
    })

    inputTokens  = res.usage.input_tokens
    outputTokens = res.usage.output_tokens
    output = res.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('').trim()

    await recordEnquiryEvent(client, {
      enquiryId,
      tenantId,
      eventType: 'DRAFT_GENERATED',
      actor:     'system',
      payload:   { model: 'claude-haiku-4-5-20251001', length: output.length },
    })

    return output
  } catch (err) {
    success = false
    error = err instanceof Error ? err.message : String(err)
    console.error('[enquiry] generateDraftReply failed:', error)
    return `Hi ${firstName ?? 'there'}, thanks for getting in touch. We'll be in touch shortly.`
  } finally {
    const durationMs = Date.now() - started
    const costUsd    = (inputTokens * 0.00000025) + (outputTokens * 0.00000125)
    client.query(
      `INSERT INTO llm_calls
         (tenant_id, purpose, model, input_tokens, output_tokens, cost_usd, duration_ms, input, output, success, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [tenantId, 'draft_reply', 'claude-haiku-4-5-20251001', inputTokens, outputTokens,
       costUsd, durationMs, summary, output, success, error || null]
    ).catch((e) => console.error('[llm_calls] insert failed:', e.message))
  }
}
