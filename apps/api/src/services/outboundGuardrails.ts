import type { PoolClient } from 'pg'

export interface GuardrailResult {
  allowed: boolean
  reason:  string
}

export interface GuardrailOptions {
  tenantId:       string
  conversationId: string
  timezone?:      string   // IANA timezone e.g. 'Europe/London'
  quietStart?:    number   // hour (0-23), default 21 (9pm)
  quietEnd?:      number   // hour (0-23), default 8  (8am)
  dailyCap?:      number   // max proactive messages per conversation per day, default 5
}

// ── Main guardrail check ──────────────────────────────────────────────────────
// Call this before sending any scheduled / proactive Telegram message.
// Returns { allowed: false, reason } if the message should be suppressed.

export async function checkOutboundGuardrails(
  client:  PoolClient,
  opts:    GuardrailOptions
): Promise<GuardrailResult> {
  const { tenantId, conversationId, timezone = 'Europe/London', quietStart = 21, quietEnd = 8, dailyCap = 5 } = opts

  // ── 1. Opt-out check ───────────────────────────────────────────────────────
  const convRes = await client.query(
    `SELECT state FROM conversations WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [conversationId, tenantId]
  )
  const state = convRes.rows[0]?.state as Record<string, unknown> ?? {}
  if (state.proactive_opted_out === true) {
    return { allowed: false, reason: 'user opted out of proactive messages' }
  }

  // ── 2. Quiet hours check ───────────────────────────────────────────────────
  const now        = new Date()
  const localHour  = getLocalHour(now, timezone)
  const inQuietHours = quietStart > quietEnd
    ? localHour >= quietStart || localHour < quietEnd   // overnight window e.g. 21–8
    : localHour >= quietStart && localHour < quietEnd   // same-day window

  if (inQuietHours) {
    return { allowed: false, reason: `quiet hours (${quietStart}:00–${quietEnd}:00 ${timezone})` }
  }

  // ── 3. Daily cap check ────────────────────────────────────────────────────
  const capRes = await client.query(
    `SELECT COUNT(*) AS cnt
     FROM messages
     WHERE conversation_id = $1
       AND direction = 'outbound'
       AND created_at >= now() - interval '24 hours'`,
    [conversationId]
  )
  const todayCount = Number(capRes.rows[0]?.cnt ?? 0)
  if (todayCount >= dailyCap) {
    return { allowed: false, reason: `daily cap reached (${todayCount}/${dailyCap} messages today)` }
  }

  return { allowed: true, reason: 'ok' }
}

// ── Handle opt-out / opt-in commands ─────────────────────────────────────────
// Call this when processing any inbound message — returns true if it was a control command.

export function detectOptOutCommand(text: string): 'stop' | 'start' | null {
  const t = text.trim().toLowerCase()
  if (['stop', '/stop', 'unsubscribe', 'opt out', 'opt-out', 'no more messages'].includes(t)) return 'stop'
  if (['start', '/start', 'subscribe', 'opt in', 'opt-in', 'resume'].includes(t)) return 'start'
  return null
}

export function applyOptOutCommand(
  state: Record<string, unknown>,
  command: 'stop' | 'start'
): { state: Record<string, unknown>; reply: string } {
  if (command === 'stop') {
    state.proactive_opted_out = true
    return {
      state,
      reply: `Got it — I won't send you any proactive messages.\n\nYou can still chat with me any time. Reply START whenever you want to re-enable updates.`,
    }
  } else {
    state.proactive_opted_out = false
    return {
      state,
      reply: `You're back on — I'll send you updates and reminders again.`,
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocalHour(date: Date, timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: 'numeric', hour12: false })
    return Number(formatter.format(date))
  } catch {
    return date.getUTCHours()
  }
}
