import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type FenRoute =
  | 'quick_reply'
  | 'onboarding'
  | 'memory_lookup'
  | 'planning'
  | 'research'
  | 'tool_task'
  | 'emotional_support'
  | 'safety_or_compliance'
  | 'unknown'

export interface FenTurnClassification {
  route:                 FenRoute
  complexity:            'low' | 'medium' | 'high'
  requiresReasoning:     boolean
  requiresTools:         boolean
  requiresMemorySearch:  boolean
  requiresApproval:      boolean
  riskLevel:             'low' | 'medium' | 'high'
  suggestedModelTier:    'fast' | 'reasoning' | 'deep'
  reason:                string
}

export type ModelTier = 'fast' | 'reasoning' | 'deep'

// ── Model selection ───────────────────────────────────────────────────────────

export function getModelForTier(tier: ModelTier): string {
  if (tier === 'fast')      return env.modelFast
  if (tier === 'reasoning') return env.modelReasoning
  if (tier === 'deep')      return env.modelDeep
  return env.modelDefault
}

export function selectModelTier(c: FenTurnClassification): ModelTier {
  if (c.riskLevel === 'high')                                       return 'reasoning'
  if (c.requiresTools)                                              return 'reasoning'
  if (c.requiresReasoning)                                          return 'reasoning'
  if (c.route === 'emotional_support')                              return 'reasoning'
  if (c.route === 'planning' || c.route === 'research')             return 'reasoning'
  if (c.route === 'safety_or_compliance')                           return 'reasoning'
  if (c.complexity === 'high')                                      return 'reasoning'
  return 'fast'
}

// ── Classifier ────────────────────────────────────────────────────────────────

const SAFE_FALLBACK: FenTurnClassification = {
  route:                'unknown',
  complexity:           'medium',
  requiresReasoning:    true,
  requiresTools:        false,
  requiresMemorySearch: true,
  requiresApproval:     false,
  riskLevel:            'low',
  suggestedModelTier:   'reasoning',
  reason:               'classifier fallback',
}

const CLASSIFIER_SYSTEM = `You are a message intent classifier for an AI assistant called Fen.
Analyse the user message and return ONLY a JSON object — no prose, no markdown, no explanation.

Routes: quick_reply | onboarding | memory_lookup | planning | research | tool_task | emotional_support | safety_or_compliance | unknown
Complexity: low | medium | high
Model tiers: fast | reasoning | deep

Rules:
- quick_reply: greetings, yes/no, simple factual one-liners
- onboarding: user introducing themselves or asking what Fen can do
- memory_lookup: user asking what Fen knows or remembers
- planning: multi-step goals, schedules, trip planning, strategy
- research: requests for current info, comparisons, market data
- tool_task: explicit action (send, post, search, book, calculate)
- emotional_support: stress, frustration, mental health, venting
- safety_or_compliance: legal, medical, financial advice, harmful requests
- unknown: ambiguous or unclear

Return exactly this shape:
{"route":"...","complexity":"...","requiresReasoning":bool,"requiresTools":bool,"requiresMemorySearch":bool,"requiresApproval":bool,"riskLevel":"...","suggestedModelTier":"...","reason":"one sentence"}`

let _ai: Anthropic | null = null
function ai() { return _ai || (_ai = new Anthropic({ apiKey: env.anthropicKey })) }

export async function classifyTurn(params: {
  inboundText:     string
  recentHistory?:  string   // last 2-3 exchanges as plain text (optional, improves accuracy)
  userProfileCtx?: string
}): Promise<FenTurnClassification> {
  const { inboundText, recentHistory, userProfileCtx } = params

  const contextLines: string[] = []
  if (userProfileCtx) contextLines.push(`User profile: ${userProfileCtx.slice(0, 200)}`)
  if (recentHistory)  contextLines.push(`Recent context:\n${recentHistory.slice(0, 400)}`)
  contextLines.push(`Message: ${inboundText}`)

  try {
    const res = await ai().messages.create({
      model:      env.modelFast,   // always use fast model for classifier
      max_tokens: 256,
      system:     CLASSIFIER_SYSTEM,
      messages:   [{ role: 'user', content: contextLines.join('\n') }],
    })

    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()

    // Strip markdown fences if present
    const json = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim()
    const parsed = JSON.parse(json) as FenTurnClassification

    // Validate required fields exist
    if (!parsed.route || !parsed.complexity || !parsed.riskLevel) return SAFE_FALLBACK

    return parsed
  } catch {
    return SAFE_FALLBACK
  }
}

// ── Max tokens by tier ────────────────────────────────────────────────────────

export function maxTokensForTier(tier: ModelTier): number {
  if (tier === 'fast')      return 1024
  if (tier === 'reasoning') return 2048
  return 4096
}
