import Anthropic from '@anthropic-ai/sdk'
import { pool } from '../db/pool.js'
import { env } from '../config/env.js'
import { listEmails, getEmailBody } from '../lib/gmail.js'
import { sendTelegram } from '../lib/telegram.js'
import { getTenantTelegram } from './jobNotifier.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

// ── Classify an email against known applications ───────────────────────────────

type EmailKind = 'interview_invite' | 'rejection' | 'offer' | 'assessment' | 'recruiter_reply' | 'other'

async function classifyEmail(subject: string, snippet: string, body: string): Promise<EmailKind> {
  const text = `Subject: ${subject}\n\n${(body || snippet).slice(0, 800)}`

  const res = await anthropic.messages.create({
    model:      env.modelFast,
    max_tokens: 20,
    messages:   [{
      role:    'user',
      content: `Classify this recruitment email into exactly one category. Reply with only the category word.

Categories: interview_invite, rejection, offer, assessment, recruiter_reply, other

Email:
${text}

Category:`,
    }],
  })

  const raw = res.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')
    .trim()
    .toLowerCase()

  const valid: EmailKind[] = ['interview_invite', 'rejection', 'offer', 'assessment', 'recruiter_reply', 'other']
  return valid.find(k => raw.includes(k)) ?? 'other'
}

// ── Match email to an application by sender domain ────────────────────────────

async function matchApplication(
  tenantId:  string,
  fromEmail: string
): Promise<string | null> {
  // Extract domain from "Name <email@domain.com>" or "email@domain.com"
  const match = fromEmail.match(/<([^>]+)>/) ?? fromEmail.match(/(\S+@\S+)/)
  const email = match?.[1] ?? fromEmail
  const domain = email.split('@')[1]
  if (!domain) return null

  const r = await pool.query<{ id: string }>(
    `SELECT a.id FROM applications a
     JOIN jobs j ON j.id = a.job_id
     WHERE a.tenant_id = $1
       AND a.status    = 'applied'
       AND (
         j.url ILIKE $2
         OR j.company ILIKE ANY(
           SELECT split_part(url, '/', 3) FROM (VALUES ($3::text)) AS t(url)
         )
       )
     ORDER BY a.applied_at DESC
     LIMIT 1`,
    [tenantId, `%${domain}%`, `https://${domain}`]
  )
  return r.rows[0]?.id ?? null
}

// ── Notification text per kind ────────────────────────────────────────────────

const STATUS_MAP: Record<EmailKind, string> = {
  interview_invite: 'interview',
  rejection:        'rejected',
  offer:            'offer',
  assessment:       'assessment',
  recruiter_reply:  'applied',
  other:            'applied',
}

const EMOJI_MAP: Record<EmailKind, string> = {
  interview_invite: '🎉',
  rejection:        '💔',
  offer:            '🏆',
  assessment:       '📝',
  recruiter_reply:  '💬',
  other:            '📧',
}

function buildNotification(kind: EmailKind, subject: string, fromEmail: string, company: string | null): string {
  const emoji = EMOJI_MAP[kind]
  const co    = company ?? fromEmail

  const headlines: Record<EmailKind, string> = {
    interview_invite: `Interview invite from ${co}!`,
    rejection:        `Update from ${co}`,
    offer:            `Offer received from ${co}!`,
    assessment:       `Assessment from ${co}`,
    recruiter_reply:  `Reply from ${co}`,
    other:            `Email from ${co}`,
  }

  return `${emoji} <b>${headlines[kind]}</b>\n\n<i>${subject}</i>\n\nCheck your inbox for details.`
}

// ── Poll one tenant's Gmail inbox ─────────────────────────────────────────────

async function pollTenantInbox(params: {
  tenantId:    string
  connectionId:string
  oauthTokens: object
  emailAddress:string
}): Promise<void> {
  const { tenantId, connectionId, oauthTokens, emailAddress } = params

  // Only look at emails since last poll (last 24h as fallback)
  const sinceRes = await pool.query<{ last_checked: Date | null }>(
    `SELECT MAX(received_at) AS last_checked FROM email_events WHERE tenant_id = $1`,
    [tenantId]
  )
  const since = sinceRes.rows[0]?.last_checked ?? new Date(Date.now() - 86400_000)
  const afterEpoch = Math.floor(since.getTime() / 1000)

  const emails = await listEmails(oauthTokens, {
    query:      `after:${afterEpoch} (interview OR offer OR reject OR application OR assessment OR opportunity OR role OR position)`,
    maxResults: 20,
    unreadOnly: false,
  })

  if (!emails.length) return

  const tg = await getTenantTelegram(tenantId)

  for (const email of emails) {
    // Skip if already logged
    const exists = await pool.query(
      `SELECT 1 FROM email_events WHERE tenant_id=$1 AND gmail_message_id=$2`,
      [tenantId, email.id]
    )
    if (exists.rows.length) continue

    // Fetch full body for classification
    let body = ''
    try { body = await getEmailBody(oauthTokens, email.id) } catch { /* use snippet */ }

    const kind          = await classifyEmail(email.subject, email.snippet ?? '', body)
    const applicationId = await matchApplication(tenantId, email.from)

    // Store event
    const evRes = await pool.query<{ id: string }>(
      `INSERT INTO email_events
         (tenant_id, application_id, email_connection_id, kind,
          subject, snippet, from_email, gmail_message_id, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [
        tenantId,
        applicationId ?? null,
        connectionId,
        kind,
        email.subject,
        (email.snippet ?? '').slice(0, 500),
        email.from,
        email.id,
      ]
    )
    if (!evRes.rows[0]) continue  // duplicate

    // Update application status if matched
    if (applicationId && STATUS_MAP[kind]) {
      const newStatus = STATUS_MAP[kind]
      await pool.query(
        `UPDATE applications
         SET status = $1, last_update_at = now()
         WHERE id = $2 AND tenant_id = $3
           AND status NOT IN ('offer','rejected','withdrawn')`,
        [newStatus, applicationId, tenantId]
      )
      await pool.query(
        `INSERT INTO application_events (tenant_id, application_id, event_type, note)
         VALUES ($1, $2, $3, $4)`,
        [
          tenantId,
          applicationId,
          kind.toUpperCase(),
          `From: ${email.from} | Subject: ${email.subject}`,
        ]
      )
    }

    // Notify Telegram for meaningful kinds only
    if (kind !== 'other' && tg) {
      // Get company name if we matched an application
      let company: string | null = null
      if (applicationId) {
        const cr = await pool.query<{ company: string | null }>(
          `SELECT j.company FROM applications a JOIN jobs j ON j.id=a.job_id WHERE a.id=$1`,
          [applicationId]
        )
        company = cr.rows[0]?.company ?? null
      }

      const message = buildNotification(kind, email.subject, email.from, company)
      await sendTelegram(tg.chatId, message, tg.botToken)

      await pool.query(
        `UPDATE email_events SET notified_telegram = true WHERE id = $1`,
        [evRes.rows[0].id]
      )
    }
  }
}

// ── Main: poll all connected Gmail accounts ───────────────────────────────────

export async function runEmailMonitor(): Promise<void> {
  const r = await pool.query<{
    id:            string
    tenant_id:     string
    email_address: string
    oauth_tokens:  object
  }>(
    `SELECT id, tenant_id, email_address, oauth_tokens
     FROM email_connections
     WHERE provider = 'gmail' AND status = 'connected'`
  )

  if (!r.rows.length) return

  console.log(`[emailMonitor] Polling ${r.rows.length} Gmail account(s)...`)

  for (const conn of r.rows) {
    try {
      await pollTenantInbox({
        tenantId:    conn.tenant_id,
        connectionId:conn.id,
        oauthTokens: conn.oauth_tokens,
        emailAddress:conn.email_address,
      })
    } catch (err) {
      console.error(`[emailMonitor] Failed for ${conn.email_address}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log('[emailMonitor] Done')
}
