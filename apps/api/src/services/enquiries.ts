import Anthropic from '@anthropic-ai/sdk'
import type { PoolClient } from 'pg'
import { env } from '../config/env.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExtractedFields {
  customer_name:    string | null
  customer_contact: string | null
  customer_postcode: string | null
  summary:          string
  missing_details:  string[]
  urgency_score:    number   // 0–100
  value_score:      number   // 0–100
  parse_confidence: number   // 0–1
}

export interface EnquiryCreateResult {
  enquiryId:         string
  customerId:        string
  matchSuggestion:   CustomerMatchSuggestion | null
}

export interface CustomerMatchSuggestion {
  existingCustomerId:   string
  existingCustomerName: string | null
  previousEnquiries:    number
  matchedOn:            'phone' | 'email'
}

// Valid status transitions
const STATUS_TRANSITIONS: Record<string, string[]> = {
  new:           ['draft_ready', 'spam', 'closed'],
  draft_ready:   ['waiting', 'handled', 'closed'],
  waiting:       ['replied', 'handled', 'closed'],
  replied:       ['qualified', 'handled', 'closed'],
  qualified:     ['survey_booked', 'quoted', 'closed'],
  survey_booked: ['quoted', 'lost', 'closed'],
  quoted:        ['job_booked', 'lost', 'closed'],
  job_booked:    ['won', 'lost', 'closed'],
  won:           ['closed'],
  lost:          ['closed'],
  handled:       ['closed'],
  spam:          ['closed'],
  closed:        [],
}

// ── 1. createEnquiryFromRawInput ──────────────────────────────────────────────

export async function createEnquiryFromRawInput(
  client: PoolClient,
  params: {
    tenantId:    string
    workerId:    string
    rawText:     string
    sourceType:  string
    chatId:      string | null
    phoneRaw?:   string
    emailRaw?:   string
  }
): Promise<EnquiryCreateResult> {
  const { tenantId, workerId, rawText, sourceType, chatId, phoneRaw, emailRaw } = params

  const phoneNorm = normalizePhone(phoneRaw ?? null)
  const emailNorm = normalizeEmail(emailRaw ?? null)

  // Fuzzy match — find likely existing customer
  const matchSuggestion = await findCustomerMatch(client, tenantId, phoneNorm, emailNorm)

  // Always create a new customer row (Option A — merge later)
  const customerRes = await client.query<{ id: string }>(
    `INSERT INTO customers (tenant_id, email, email_normalized, phone, phone_normalized, first_enquiry_at, last_enquiry_at)
     VALUES ($1, $2, $3, $4, $5, now(), now())
     RETURNING id`,
    [tenantId, emailRaw ?? null, emailNorm, phoneRaw ?? null, phoneNorm]
  )
  const customerId = customerRes.rows[0].id

  // Create enquiry row
  const enquiryRes = await client.query<{ id: string }>(
    `INSERT INTO enquiries
       (tenant_id, worker_id, customer_id, source_type, telegram_chat_id, enquiry_text)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [tenantId, workerId, customerId, sourceType, chatId, rawText]
  )
  const enquiryId = enquiryRes.rows[0].id

  // Create inbound_source row
  await client.query(
    `INSERT INTO inbound_sources (enquiry_id, tenant_id, channel_type, raw_payload)
     VALUES ($1, $2, $3, $4)`,
    [enquiryId, tenantId, sourceType, JSON.stringify({ raw_text: rawText, chat_id: chatId })]
  )

  // Fire ENQUIRY_CREATED event
  await recordEnquiryEvent(client, {
    enquiryId,
    tenantId,
    eventType: 'ENQUIRY_CREATED',
    actor:     'system',
    payload:   { source_type: sourceType },
  })

  // Fire CUSTOMER_MATCH_SUGGESTED if applicable
  if (matchSuggestion) {
    await recordEnquiryEvent(client, {
      enquiryId,
      tenantId,
      eventType: 'CUSTOMER_MATCH_SUGGESTED',
      actor:     'system',
      payload:   {
        existing_customer_id:   matchSuggestion.existingCustomerId,
        existing_customer_name: matchSuggestion.existingCustomerName,
        previous_enquiries:     matchSuggestion.previousEnquiries,
        matched_on:             matchSuggestion.matchedOn,
      },
    })
  }

  return { enquiryId, customerId, matchSuggestion }
}

// ── 2. extractEnquiryFields ───────────────────────────────────────────────────

export async function extractEnquiryFields(
  client: PoolClient,
  tenantId: string,
  rawText: string
): Promise<ExtractedFields> {
  const started = Date.now()

  const prompt = `You are extracting structured data from a trade enquiry message for a UK trades business (plumber, electrician, builder, cleaner).

Extract the following fields from the message. Return ONLY valid JSON, no other text.

Fields:
- customer_name: string or null
- customer_contact: string or null (phone or email)
- customer_postcode: string or null (UK postcode or area, e.g. "SW18", "Balham", "SW12 8AB")
- summary: string (1-2 sentences describing the job needed)
- missing_details: array of strings (what information is absent — e.g. ["budget", "timeline", "access details"])
- urgency_score: integer 0-100 (0=no urgency stated, 100=emergency today)
- value_score: integer 0-100 (0=no value signals, 100=large job with budget confirmed)
- parse_confidence: float 0-1 (how confident you are in this extraction)

Message:
${rawText}

Return JSON only.`

  let output = ''
  let success = true
  let error = ''
  let inputTokens = 0
  let outputTokens = 0

  try {
    const res = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages:   [{ role: 'user', content: prompt }],
    })

    inputTokens  = res.usage.input_tokens
    outputTokens = res.usage.output_tokens
    output = res.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('').trim()

    const parsed = JSON.parse(output) as ExtractedFields
    return parsed
  } catch (err) {
    success = false
    error = err instanceof Error ? err.message : String(err)
    console.error('[enquiry] extractEnquiryFields failed:', error)

    // Fallback — preserve the enquiry even if extraction fails
    return {
      customer_name:    null,
      customer_contact: null,
      customer_postcode: null,
      summary:          rawText.slice(0, 200),
      missing_details:  ['customer name', 'contact', 'job details'],
      urgency_score:    50,
      value_score:      30,
      parse_confidence: 0,
    }
  } finally {
    const durationMs = Date.now() - started
    const costUsd    = (inputTokens * 0.00000025) + (outputTokens * 0.00000125)

    client.query(
      `INSERT INTO llm_calls
         (tenant_id, purpose, model, input_tokens, output_tokens, cost_usd, duration_ms, input, output, success, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [tenantId, 'extraction', 'claude-haiku-4-5-20251001', inputTokens, outputTokens,
       costUsd, durationMs, rawText, output, success, error || null]
    ).catch((e) => console.error('[llm_calls] insert failed:', e.message))
  }
}

// ── 3. computeFitScore ────────────────────────────────────────────────────────
// Deterministic — no LLM. Postcode prefix matching vs service_areas array.

export function computeFitScore(
  customerPostcode: string | null,
  serviceAreas: string[]
): { fitScore: number; serviceAreaMatch: boolean } {
  if (!customerPostcode || serviceAreas.length === 0) {
    return { fitScore: 50, serviceAreaMatch: false }
  }

  const postcode = customerPostcode.trim().toUpperCase()

  for (const area of serviceAreas) {
    const a = area.trim().toUpperCase()

    // Exact match (e.g. "SW12 8AB" === "SW12 8AB")
    if (postcode === a) return { fitScore: 100, serviceAreaMatch: true }

    // Postcode district match (e.g. "SW12" in "SW12 8AB")
    if (postcode.startsWith(a) || a.startsWith(postcode.split(' ')[0])) {
      return { fitScore: 100, serviceAreaMatch: true }
    }

    // Area name match (e.g. "Balham" in "Balham, SW12")
    if (postcode.includes(a) || a.includes(postcode.split(' ')[0])) {
      return { fitScore: 80, serviceAreaMatch: true }
    }
  }

  return { fitScore: 0, serviceAreaMatch: false }
}

// ── 4. computeLeadScore ───────────────────────────────────────────────────────
// Weighted composite. Weights tunable per tenant via business_memory_core.

export function computeLeadScore(
  fitScore: number,
  urgencyScore: number,
  valueScore: number,
  weights = { fit: 0.4, urgency: 0.35, value: 0.25 }
): number {
  return Math.round(
    fitScore    * weights.fit    +
    urgencyScore * weights.urgency +
    valueScore   * weights.value
  )
}

// ── 5. recordEnquiryEvent ─────────────────────────────────────────────────────

export async function recordEnquiryEvent(
  client: PoolClient,
  params: {
    enquiryId: string
    tenantId:  string
    eventType: string
    actor:     string
    payload?:  Record<string, unknown>
  }
): Promise<void> {
  await client.query(
    `INSERT INTO enquiry_events (enquiry_id, tenant_id, event_type, actor, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [params.enquiryId, params.tenantId, params.eventType, params.actor, JSON.stringify(params.payload ?? {})]
  )
}

// ── 6. updateEnquiryStatus ────────────────────────────────────────────────────

export async function updateEnquiryStatus(
  client: PoolClient,
  params: {
    enquiryId: string
    tenantId:  string
    newStatus: string
    actor:     string
    outcome?:  string
  }
): Promise<{ success: boolean; error?: string }> {
  const res = await client.query<{ status: string }>(
    `SELECT status FROM enquiries WHERE id = $1 AND tenant_id = $2`,
    [params.enquiryId, params.tenantId]
  )

  if (!res.rows[0]) return { success: false, error: 'Enquiry not found' }

  const current = res.rows[0].status
  const allowed = STATUS_TRANSITIONS[current] ?? []

  if (!allowed.includes(params.newStatus)) {
    return { success: false, error: `Cannot move from ${current} to ${params.newStatus}` }
  }

  const isTerminal = ['won', 'lost', 'handled', 'spam', 'closed'].includes(params.newStatus)

  await client.query(
    `UPDATE enquiries
     SET status     = $1,
         outcome    = COALESCE($2, outcome),
         handled_at = CASE WHEN $3 THEN now() ELSE handled_at END,
         updated_at = now()
     WHERE id = $4 AND tenant_id = $5`,
    [params.newStatus, params.outcome ?? null, isTerminal, params.enquiryId, params.tenantId]
  )

  await recordEnquiryEvent(client, {
    enquiryId: params.enquiryId,
    tenantId:  params.tenantId,
    eventType: 'STATUS_CHANGED',
    actor:     params.actor,
    payload:   { from: current, to: params.newStatus, outcome: params.outcome },
  })

  return { success: true }
}

// ── 7. applyExtractionToEnquiry ───────────────────────────────────────────────
// Saves extracted fields + scores back to enquiry row.

export async function applyExtractionToEnquiry(
  client: PoolClient,
  params: {
    enquiryId:  string
    tenantId:   string
    extracted:  ExtractedFields
    fitScore:   number
    leadScore:  number
    serviceAreaMatch: boolean
  }
): Promise<void> {
  const { enquiryId, tenantId, extracted, fitScore, leadScore, serviceAreaMatch } = params

  await client.query(
    `UPDATE enquiries
     SET customer_name     = COALESCE($1, customer_name),
         customer_contact  = COALESCE($2, customer_contact),
         customer_postcode = COALESCE($3, customer_postcode),
         summary           = $4,
         missing_details   = $5,
         service_area_match = $6,
         fit_score         = $7,
         urgency_score     = $8,
         value_score       = $9,
         lead_score        = $10,
         updated_at        = now()
     WHERE id = $11 AND tenant_id = $12`,
    [
      extracted.customer_name,
      extracted.customer_contact,
      extracted.customer_postcode,
      extracted.summary,
      JSON.stringify(extracted.missing_details),
      serviceAreaMatch,
      fitScore,
      extracted.urgency_score,
      extracted.value_score,
      leadScore,
      enquiryId,
      tenantId,
    ]
  )

  // Update customer name if we got one
  if (extracted.customer_name) {
    const enqRes = await client.query<{ customer_id: string }>(
      `SELECT customer_id FROM enquiries WHERE id = $1`,
      [enquiryId]
    )
    if (enqRes.rows[0]) {
      await client.query(
        `UPDATE customers SET name = COALESCE(name, $1), last_enquiry_at = now() WHERE id = $2`,
        [extracted.customer_name, enqRes.rows[0].customer_id]
      )
    }
  }

  await recordEnquiryEvent(client, {
    enquiryId,
    tenantId,
    eventType: 'SCORE_ASSIGNED',
    actor:     'system',
    payload:   {
      fit_score:     fitScore,
      urgency_score: extracted.urgency_score,
      value_score:   extracted.value_score,
      lead_score:    leadScore,
      service_area_match: serviceAreaMatch,
      parse_confidence:   extracted.parse_confidence,
    },
  })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findCustomerMatch(
  client: PoolClient,
  tenantId: string,
  phoneNorm: string | null,
  emailNorm: string | null
): Promise<CustomerMatchSuggestion | null> {
  if (!phoneNorm && !emailNorm) return null

  if (phoneNorm) {
    const r = await client.query<{ id: string; name: string | null; count: string }>(
      `SELECT c.id, c.name, COUNT(e.id) AS count
       FROM customers c
       LEFT JOIN enquiries e ON e.customer_id = c.id
       WHERE c.tenant_id = $1 AND c.phone_normalized = $2
       GROUP BY c.id, c.name
       LIMIT 1`,
      [tenantId, phoneNorm]
    )
    if (r.rows[0]) {
      return {
        existingCustomerId:   r.rows[0].id,
        existingCustomerName: r.rows[0].name,
        previousEnquiries:    Number(r.rows[0].count),
        matchedOn:            'phone',
      }
    }
  }

  if (emailNorm) {
    const r = await client.query<{ id: string; name: string | null; count: string }>(
      `SELECT c.id, c.name, COUNT(e.id) AS count
       FROM customers c
       LEFT JOIN enquiries e ON e.customer_id = c.id
       WHERE c.tenant_id = $1 AND c.email_normalized = $2
       GROUP BY c.id, c.name
       LIMIT 1`,
      [tenantId, emailNorm]
    )
    if (r.rows[0]) {
      return {
        existingCustomerId:   r.rows[0].id,
        existingCustomerName: r.rows[0].name,
        previousEnquiries:    Number(r.rows[0].count),
        matchedOn:            'email',
      }
    }
  }

  return null
}

export function normalizePhone(phone: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (digits.startsWith('44')) return '+' + digits
  if (digits.startsWith('0') && digits.length === 11) return '+44' + digits.slice(1)
  if (digits.length >= 10) return digits
  return null
}

export function normalizeEmail(email: string | null): string | null {
  if (!email) return null
  return email.trim().toLowerCase()
}
