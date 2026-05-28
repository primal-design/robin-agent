import { pool }                                       from '../db/pool.js'
import { withTenant }                                from '../db/withTenant.js'
import { listEmails }                                from '../lib/gmail.js'
import { refreshConnectorTokens }                    from '../lib/gmail.js'
import { listDriveFiles, exportFileContent,
         refreshGdriveTokens }                       from '../lib/gdrive.js'
import { listPublicChannels, getChannelHistory,
         resolveDisplayName, isoWeekKey }            from '../lib/slack.js'
import { listHubspotCompanies, listHubspotDeals,
         listHubspotContacts,
         refreshHubspotTokens }                      from '../lib/hubspot.js'
import { encryptToken }                              from '../lib/encrypt.js'

interface TokenSet {
  access_token:  string
  refresh_token: string
  expiry_date:   number | null
}

interface SyncParams {
  tenantId:    string
  workerId:    string
  grantId:     string
  tokens:      TokenSet
  trigger:     'manual' | 'scheduled'
  callbackUri: string
}

export interface SyncResult {
  ingested:   number
  candidates: number
  error?:     string
}

// Ensure tokens are fresh; if expiry is within 5 min, refresh and persist new tokens
async function ensureFreshTokens(params: SyncParams): Promise<TokenSet> {
  const { tokens, grantId, callbackUri } = params
  const expiresAt = tokens.expiry_date ?? 0
  const fiveMinMs = 5 * 60 * 1000

  if (!tokens.refresh_token || expiresAt > Date.now() + fiveMinMs) {
    return tokens  // still valid
  }

  const fresh = await refreshConnectorTokens(tokens.refresh_token, callbackUri)

  // Persist updated access token (encrypted)
  await pool.query(
    `UPDATE tenant_data_source_grants
     SET access_token_enc = $1,
         token_expiry     = $2,
         updated_at       = now()
     WHERE id = $3`,
    [encryptToken(fresh.access_token), fresh.expiry_date, grantId]
  )

  return { ...tokens, access_token: fresh.access_token, expiry_date: fresh.expiry_date }
}

// Extract just the sender email address from a "Name <email>" header
function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return match ? match[1].toLowerCase() : from.trim().toLowerCase()
}

export async function syncGmailConnector(params: SyncParams): Promise<SyncResult> {
  const { tenantId, workerId, grantId, trigger } = params

  // Record the start of this sync run
  const runRes = await pool.query(
    `INSERT INTO connector_sync_runs
       (tenant_id, grant_id, provider, trigger, status)
     VALUES ($1,$2,'gmail',$3,'running')
     RETURNING id`,
    [tenantId, grantId, trigger]
  )
  const runId = runRes.rows[0].id as string

  let ingested   = 0
  let candidates = 0

  try {
    const freshTokens = await ensureFreshTokens(params)
    const emails = await listEmails(freshTokens, { maxResults: 40 })

    if (!emails.length) {
      await finaliseRun(runId, 'ok', 0, 0)
      await updateGrant(grantId, 'ok', 0, null)
      return { ingested: 0, candidates: 0 }
    }

    // ── Group by sender for consolidated search rows ──────────────────────────
    const bySender = new Map<string, typeof emails>()
    for (const email of emails) {
      const senderEmail = extractEmail(email.from || '')
      if (!senderEmail) continue
      const list = bySender.get(senderEmail) ?? []
      list.push(email)
      bySender.set(senderEmail, list)
    }

    // ── All tenant data writes inside withTenant (sets app.current_tenant for RLS) ──
    await withTenant(tenantId, async (client) => {
      for (const [senderEmail, msgs] of bySender.entries()) {
        const displayFrom = msgs[0].from || senderEmail
        const subjects    = msgs.map(m => m.subject || '(no subject)').slice(0, 5)
        const snippets    = msgs.map(m => m.snippet).filter(Boolean).slice(0, 3)

        const title = `Email contact: ${displayFrom}`
        const content = [
          `Contact: ${displayFrom}`,
          `Emails: ${msgs.length} in recent sync`,
          `Recent subjects: ${subjects.join(' | ')}`,
          snippets.length ? `Snippets: ${snippets.join(' … ')}` : '',
        ].filter(Boolean).join('\n')

        const sourceRef = `gmail:sender:${senderEmail}`

        const { rows } = await client.query(
          `INSERT INTO business_memory_search
             (tenant_id, source_type, source_ref, title, content, metadata, embedding_queued_at)
           VALUES ($1, 'integration', $2, $3, $4, $5, now())
           ON CONFLICT (tenant_id, source_type, source_ref) DO UPDATE SET
             title                = EXCLUDED.title,
             content              = EXCLUDED.content,
             metadata             = EXCLUDED.metadata,
             embedding_queued_at  = now(),
             updated_at           = now()
           RETURNING id`,
          [
            tenantId,
            sourceRef,
            title,
            content,
            JSON.stringify({
              provider:     'gmail',
              sender_email: senderEmail,
              email_count:  msgs.length,
              worker_id:    workerId,
            }),
          ]
        )
        if (rows.length) ingested++

        if (msgs.length >= 3) {
          const candidateKey = `frequent_contact:${senderEmail}`
          const existing = await client.query(
            `SELECT id FROM business_memory_candidates
             WHERE tenant_id=$1
               AND source_type='integration'
               AND source_ref='gmail'
               AND proposed_memory_key=$2
               AND status IN ('pending','approved','promoted')
             LIMIT 1`,
            [tenantId, candidateKey]
          )
          if (!existing.rows.length) {
            await client.query(
              `INSERT INTO business_memory_candidates
                 (tenant_id, target_layer, proposed_memory_key, proposed_memory_value,
                  proposed_content, source_type, source_ref, reason, risk_level, requires_approval)
               VALUES ($1, 'core', $2, $3, $4, 'integration', 'gmail', $5, 'low', true)`,
              [
                tenantId,
                candidateKey,
                JSON.stringify({ sender: displayFrom, email: senderEmail, email_count: msgs.length, provider: 'gmail' }),
                `Frequent Gmail contact: ${displayFrom} (${msgs.length} emails in last sync)`,
                `${displayFrom} (${senderEmail}) appeared ${msgs.length} times in the recent Gmail sync. Consider noting as a frequent contact.`,
              ]
            )
            candidates++
          }
        }
      }

      await client.query(
        `INSERT INTO business_memory_events
           (tenant_id, memory_layer, action, reason, actor_type, source_type, source_ref)
         VALUES ($1, 'search', 'sync_completed', $2, 'integration', 'gmail', $3)`,
        [tenantId, `Gmail sync: ${ingested} contacts updated, ${candidates} candidates created`, `grant:${grantId}`]
      )
    })

    await finaliseRun(runId, 'ok', ingested, candidates)
    await updateGrant(grantId, 'ok', ingested, null)
    return { ingested, candidates }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[connectorSync/gmail] ${message}`)

    withTenant(tenantId, (client) => client.query(
      `INSERT INTO business_memory_events
         (tenant_id, memory_layer, action, reason, actor_type, source_type, source_ref)
       VALUES ($1, 'search', 'sync_failed', $2, 'integration', 'gmail', $3)`,
      [tenantId, `Gmail sync error: ${message}`, `grant:${grantId}`]
    )).catch(() => {/* non-fatal */})

    await finaliseRun(runId, 'error', ingested, candidates, message)
    await updateGrant(grantId, 'error', ingested, message)
    return { ingested, candidates, error: message }
  }
}

// ── Slack sync ────────────────────────────────────────────────────────────────

// Slack bot tokens don't expire — no refresh needed.
// We only pass access_token; refresh_token is always empty for Slack.

export async function syncSlackConnector(params: SyncParams): Promise<SyncResult> {
  const { tenantId, workerId, grantId, trigger } = params

  const runRes = await pool.query(
    `INSERT INTO connector_sync_runs
       (tenant_id, grant_id, provider, trigger, status)
     VALUES ($1,$2,'slack',$3,'running')
     RETURNING id`,
    [tenantId, grantId, trigger]
  )
  const runId = runRes.rows[0].id as string

  let ingested   = 0
  let candidates = 0

  try {
    const token    = params.tokens.access_token
    const channels = await listPublicChannels(token, 10)

    if (!channels.length) {
      await finaliseRun(runId, 'ok', 0, 0)
      await updateGrant(grantId, 'ok', 0, null)
      return { ingested: 0, candidates: 0 }
    }

    // Sync last 7 days of messages, grouped by channel × ISO week
    const sevenDaysAgo = String(Math.floor((Date.now() - 7 * 86400 * 1000) / 1000))
    const weekKey      = isoWeekKey(new Date())

    // ── Resolve display names before entering the transaction ────────────────
    type ChannelData = {
      channel:  (typeof channels)[number]
      content:  string
      sourceRef: string
    }
    const channelData: ChannelData[] = []

    for (const channel of channels) {
      const messages = await getChannelHistory(token, channel.id, sevenDaysAgo, 80)
      if (!messages.length) continue

      const uniqueUsers = [...new Set(messages.map(m => m.user).filter(Boolean))].slice(0, 10)
      const nameMap = new Map<string, string>()
      for (const uid of uniqueUsers) {
        nameMap.set(uid, await resolveDisplayName(token, uid))
      }

      const msgLines = messages.slice(0, 30).map(m => {
        const who  = nameMap.get(m.user) || m.username || 'unknown'
        const text = m.text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
        return `[${who}]: ${text}`
      })

      channelData.push({
        channel,
        content: [
          `Channel: #${channel.name}`,
          channel.topic   ? `Topic: ${channel.topic}`     : '',
          channel.purpose ? `Purpose: ${channel.purpose}` : '',
          `Messages (${messages.length} in last 7 days):`,
          msgLines.join('\n'),
        ].filter(Boolean).join('\n'),
        sourceRef: `slack:channel:${channel.id}:week:${weekKey}`,
      })
    }

    // ── All tenant data writes inside withTenant ──────────────────────────────
    await withTenant(tenantId, async (client) => {
      for (const { channel, content, sourceRef } of channelData) {
        await client.query(
          `INSERT INTO business_memory_search
             (tenant_id, source_type, source_ref, title, content, metadata, embedding_queued_at)
           VALUES ($1, 'integration', $2, $3, $4, $5, now())
           ON CONFLICT (tenant_id, source_type, source_ref) DO UPDATE SET
             title               = EXCLUDED.title,
             content             = EXCLUDED.content,
             metadata            = EXCLUDED.metadata,
             embedding_queued_at = now(),
             updated_at          = now()`,
          [
            tenantId,
            sourceRef,
            `Slack #${channel.name} — week ${weekKey}`,
            content.slice(0, 4000),
            JSON.stringify({
              provider:      'slack',
              channel_id:    channel.id,
              channel_name:  channel.name,
              week:          weekKey,
              worker_id:     workerId,
              sync_run_id:   runId,
            }),
          ]
        )
        ingested++

        const SIGNAL_NAMES = /\b(decision|announce|strategy|policy|process|handbook|docs|important|key-info)\b/i
        if (SIGNAL_NAMES.test(channel.name) || SIGNAL_NAMES.test(channel.purpose)) {
          const candidateKey = `slack_channel:${channel.id}`
          const existing = await client.query(
            `SELECT id FROM business_memory_candidates
             WHERE tenant_id=$1
               AND source_type='integration'
               AND source_ref='slack'
               AND proposed_memory_key=$2
               AND status IN ('pending','approved','promoted')
             LIMIT 1`,
            [tenantId, candidateKey]
          )
          if (!existing.rows.length) {
            await client.query(
              `INSERT INTO business_memory_candidates
                 (tenant_id, target_layer, proposed_memory_key, proposed_memory_value,
                  proposed_content, source_type, source_ref, reason, risk_level, requires_approval)
               VALUES ($1, 'search', $2, $3, $4, 'integration', 'slack', $5, 'low', true)`,
              [
                tenantId,
                candidateKey,
                JSON.stringify({ channel_id: channel.id, channel_name: channel.name, provider: 'slack' }),
                content.slice(0, 300),
                `Slack #${channel.name} appears to contain team decisions or announcements — may be worth noting as business context.`,
              ]
            )
            candidates++
          }
        }
      }

      await client.query(
        `INSERT INTO business_memory_events
           (tenant_id, memory_layer, action, reason, actor_type, source_type, source_ref)
         VALUES ($1, 'search', 'sync_completed', $2, 'integration', 'slack', $3)`,
        [tenantId, `Slack sync: ${ingested} channels updated, ${candidates} candidates created`, `grant:${grantId}`]
      )
    })

    await finaliseRun(runId, 'ok', ingested, candidates)
    await updateGrant(grantId, 'ok', ingested, null)
    return { ingested, candidates }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[connectorSync/slack] ${message}`)

    withTenant(tenantId, (client) => client.query(
      `INSERT INTO business_memory_events
         (tenant_id, memory_layer, action, reason, actor_type, source_type, source_ref)
       VALUES ($1, 'search', 'sync_failed', $2, 'integration', 'slack', $3)`,
      [tenantId, `Slack sync error: ${message}`, `grant:${grantId}`]
    )).catch(() => {/* non-fatal */})

    await finaliseRun(runId, 'error', ingested, candidates, message)
    await updateGrant(grantId, 'error', ingested, message)
    return { ingested, candidates, error: message }
  }
}

// Provider-aware token refresh
async function ensureFreshTokensForProvider(
  params: SyncParams,
  provider: 'gmail' | 'gdrive' | 'hubspot'
): Promise<TokenSet> {
  const { tokens, grantId, callbackUri } = params
  const expiresAt  = tokens.expiry_date ?? 0
  const fiveMinMs  = 5 * 60 * 1000

  // Slack bot tokens never expire; HubSpot access tokens expire in 30 min
  if (!tokens.refresh_token || expiresAt > Date.now() + fiveMinMs) {
    return tokens
  }

  let fresh: { access_token: string; expiry_date: number }
  if (provider === 'gdrive') {
    fresh = await refreshGdriveTokens(tokens.refresh_token, callbackUri)
  } else if (provider === 'hubspot') {
    fresh = await refreshHubspotTokens(tokens.refresh_token, callbackUri)
  } else {
    fresh = await refreshConnectorTokens(tokens.refresh_token, callbackUri)
  }

  await pool.query(
    `UPDATE tenant_data_source_grants
     SET access_token_enc = $1,
         token_expiry     = $2,
         updated_at       = now()
     WHERE id = $3`,
    [encryptToken(fresh.access_token), fresh.expiry_date, grantId]
  )

  return { ...tokens, access_token: fresh.access_token, expiry_date: fresh.expiry_date }
}

export async function syncGdriveConnector(params: SyncParams): Promise<SyncResult> {
  const { tenantId, workerId, grantId, trigger } = params

  const runRes = await pool.query(
    `INSERT INTO connector_sync_runs
       (tenant_id, grant_id, provider, trigger, status)
     VALUES ($1,$2,'gdrive',$3,'running')
     RETURNING id`,
    [tenantId, grantId, trigger]
  )
  const runId = runRes.rows[0].id as string

  let ingested   = 0
  let candidates = 0

  try {
    const freshTokens = await ensureFreshTokensForProvider(params, 'gdrive')
    const files = await listDriveFiles(freshTokens, 30)

    if (!files.length) {
      await finaliseRun(runId, 'ok', 0, 0)
      await updateGrant(grantId, 'ok', 0, null)
      return { ingested: 0, candidates: 0 }
    }

    // ── Export file contents before entering the transaction ─────────────────
    type FileData = {
      file:     (typeof files)[number]
      body:     string
      content:  string
      sourceRef: string
    }
    const fileData: FileData[] = []
    for (const file of files) {
      const content = await exportFileContent(freshTokens, file)
      fileData.push({
        file,
        body: content.length > 0
          ? content
          : `File: ${file.name}\nType: ${file.mimeType}\nModified: ${file.modifiedTime}`,
        content,
        sourceRef: `gdrive:file:${file.id}`,
      })
    }

    // ── All tenant data writes inside withTenant ──────────────────────────────
    await withTenant(tenantId, async (client) => {
      for (const { file, body, content, sourceRef } of fileData) {
        await client.query(
          `INSERT INTO business_memory_search
             (tenant_id, source_type, source_ref, title, content, metadata, embedding_queued_at)
           VALUES ($1, 'integration', $2, $3, $4, $5, now())
           ON CONFLICT (tenant_id, source_type, source_ref) DO UPDATE SET
             title               = EXCLUDED.title,
             content             = EXCLUDED.content,
             metadata            = EXCLUDED.metadata,
             embedding_queued_at = now(),
             updated_at          = now()`,
          [
            tenantId,
            sourceRef,
            `Google Drive: ${file.name}`,
            body,
            JSON.stringify({
              provider:      'gdrive',
              file_id:       file.id,
              file_name:     file.name,
              mime_type:     file.mimeType,
              modified_time: file.modifiedTime,
              web_view_link: file.webViewLink,
              owner_email:   file.ownerEmail,
              worker_id:     workerId,
              sync_run_id:   runId,
            }),
          ]
        )
        ingested++

        if (
          file.mimeType === 'application/vnd.google-apps.document' &&
          content.length > 400
        ) {
          const candidateKey = `gdrive_doc:${file.id}`
          const existing = await client.query(
            `SELECT id FROM business_memory_candidates
             WHERE tenant_id=$1
               AND source_type='integration'
               AND source_ref='gdrive'
               AND proposed_memory_key=$2
               AND status IN ('pending','approved','promoted')
             LIMIT 1`,
            [tenantId, candidateKey]
          )
          if (!existing.rows.length) {
            await client.query(
              `INSERT INTO business_memory_candidates
                 (tenant_id, target_layer, proposed_memory_key, proposed_memory_value,
                  proposed_content, source_type, source_ref, reason, risk_level, requires_approval)
               VALUES ($1, 'search', $2, $3, $4, 'integration', 'gdrive', $5, 'low', true)`,
              [
                tenantId,
                candidateKey,
                JSON.stringify({ file_id: file.id, name: file.name, provider: 'gdrive', web_link: file.webViewLink }),
                content.slice(0, 300).replace(/\s+/g, ' '),
                `Google Doc "${file.name}" contains substantial content that may be useful as business context.`,
              ]
            )
            candidates++
          }
        }
      }

      await client.query(
        `INSERT INTO business_memory_events
           (tenant_id, memory_layer, action, reason, actor_type, source_type, source_ref)
         VALUES ($1, 'search', 'sync_completed', $2, 'integration', 'gdrive', $3)`,
        [tenantId, `Google Drive sync: ${ingested} files updated, ${candidates} candidates created`, `grant:${grantId}`]
      )
    })

    await finaliseRun(runId, 'ok', ingested, candidates)
    await updateGrant(grantId, 'ok', ingested, null)
    return { ingested, candidates }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[connectorSync/gdrive] ${message}`)

    withTenant(tenantId, (client) => client.query(
      `INSERT INTO business_memory_events
         (tenant_id, memory_layer, action, reason, actor_type, source_type, source_ref)
       VALUES ($1, 'search', 'sync_failed', $2, 'integration', 'gdrive', $3)`,
      [tenantId, `Google Drive sync error: ${message}`, `grant:${grantId}`]
    )).catch(() => {/* non-fatal */})

    await finaliseRun(runId, 'error', ingested, candidates, message)
    await updateGrant(grantId, 'error', ingested, message)
    return { ingested, candidates, error: message }
  }
}

export async function syncHubspotConnector(params: SyncParams): Promise<SyncResult> {
  const { tenantId, workerId, grantId, trigger } = params

  const runRes = await pool.query(
    `INSERT INTO connector_sync_runs
       (tenant_id, grant_id, provider, trigger, status)
     VALUES ($1,$2,'hubspot',$3,'running')
     RETURNING id`,
    [tenantId, grantId, trigger]
  )
  const runId = runRes.rows[0].id as string

  let ingested   = 0
  let candidates = 0

  try {
    const freshTokens = await ensureFreshTokensForProvider(params, 'hubspot')
    const token = freshTokens.access_token

    // ── Fetch all external data before entering the transaction ───────────────
    const companies = await listHubspotCompanies(token, 50)
    const deals     = await listHubspotDeals(token, 50)
    const contacts  = await listHubspotContacts(token, 100)

    // ── All tenant data writes inside withTenant ──────────────────────────────
    await withTenant(tenantId, async (client) => {
      for (const company of companies) {
        if (!company.name) continue

        const sourceRef = `hubspot:company:${company.id}`
        const lines = [
          `Company: ${company.name}`,
          company.domain            ? `Domain: ${company.domain}`                      : '',
          company.industry          ? `Industry: ${company.industry}`                  : '',
          company.city || company.country
            ? `Location: ${[company.city, company.country].filter(Boolean).join(', ')}` : '',
          company.numberOfEmployees ? `Employees: ${company.numberOfEmployees}`        : '',
          company.phone             ? `Phone: ${company.phone}`                         : '',
        ].filter(Boolean)

        await client.query(
          `INSERT INTO business_memory_search
             (tenant_id, source_type, source_ref, title, content, metadata, embedding_queued_at)
           VALUES ($1, 'integration', $2, $3, $4, $5, now())
           ON CONFLICT (tenant_id, source_type, source_ref) DO UPDATE SET
             title               = EXCLUDED.title,
             content             = EXCLUDED.content,
             metadata            = EXCLUDED.metadata,
             embedding_queued_at = now(),
             updated_at          = now()`,
          [
            tenantId, sourceRef, `HubSpot company: ${company.name}`, lines.join('\n'),
            JSON.stringify({ provider: 'hubspot', company_id: company.id, name: company.name, domain: company.domain, industry: company.industry, worker_id: workerId, sync_run_id: runId }),
          ]
        )
        ingested++

        if (company.domain) {
          const candidateKey = `hubspot_company:${company.id}`
          const existing = await client.query(
            `SELECT id FROM business_memory_candidates WHERE tenant_id=$1 AND source_type='integration' AND source_ref='hubspot' AND proposed_memory_key=$2 AND status IN ('pending','approved','promoted') LIMIT 1`,
            [tenantId, candidateKey]
          )
          if (!existing.rows.length) {
            await client.query(
              `INSERT INTO business_memory_candidates (tenant_id, target_layer, proposed_memory_key, proposed_memory_value, proposed_content, source_type, source_ref, reason, risk_level, requires_approval) VALUES ($1, 'core', $2, $3, $4, 'integration', 'hubspot', $5, 'low', true)`,
              [tenantId, candidateKey, JSON.stringify({ company_id: company.id, name: company.name, domain: company.domain, provider: 'hubspot' }), lines.join('\n').slice(0, 300), `HubSpot company "${company.name}" (${company.domain}) may be a key business contact or client.`]
            )
            candidates++
          }
        }
      }

      for (const deal of deals) {
        if (!deal.name) continue

        const sourceRef = `hubspot:deal:${deal.id}`
        const amountStr = deal.amount ? `£${Number(deal.amount).toLocaleString()}` : ''
        const lines = [
          `Deal: ${deal.name}`,
          deal.stage     ? `Stage: ${deal.stage}`         : '',
          amountStr      ? `Amount: ${amountStr}`          : '',
          deal.closeDate ? `Close date: ${deal.closeDate}` : '',
          deal.pipeline  ? `Pipeline: ${deal.pipeline}`    : '',
        ].filter(Boolean)

        await client.query(
          `INSERT INTO business_memory_search
             (tenant_id, source_type, source_ref, title, content, metadata, embedding_queued_at)
           VALUES ($1, 'integration', $2, $3, $4, $5, now())
           ON CONFLICT (tenant_id, source_type, source_ref) DO UPDATE SET
             title               = EXCLUDED.title,
             content             = EXCLUDED.content,
             metadata            = EXCLUDED.metadata,
             embedding_queued_at = now(),
             updated_at          = now()`,
          [
            tenantId, sourceRef, `HubSpot deal: ${deal.name}`, lines.join('\n'),
            JSON.stringify({ provider: 'hubspot', deal_id: deal.id, name: deal.name, stage: deal.stage, amount: deal.amount, close_date: deal.closeDate, pipeline: deal.pipeline, worker_id: workerId, sync_run_id: runId }),
          ]
        )
        ingested++

        const isSignificant = (deal.amount && Number(deal.amount) > 0) ||
          /\b(closed_won|proposal|contract|negotiat)\b/i.test(deal.stage ?? '')
        if (isSignificant) {
          const candidateKey = `hubspot_deal:${deal.id}`
          const existing = await client.query(
            `SELECT id FROM business_memory_candidates WHERE tenant_id=$1 AND source_type='integration' AND source_ref='hubspot' AND proposed_memory_key=$2 AND status IN ('pending','approved','promoted') LIMIT 1`,
            [tenantId, candidateKey]
          )
          if (!existing.rows.length) {
            await client.query(
              `INSERT INTO business_memory_candidates (tenant_id, target_layer, proposed_memory_key, proposed_memory_value, proposed_content, source_type, source_ref, reason, risk_level, requires_approval) VALUES ($1, 'core', $2, $3, $4, 'integration', 'hubspot', $5, 'low', true)`,
              [tenantId, candidateKey, JSON.stringify({ deal_id: deal.id, name: deal.name, stage: deal.stage, amount: deal.amount, provider: 'hubspot' }), lines.join('\n').slice(0, 300), `HubSpot deal "${deal.name}" is in stage "${deal.stage}"${amountStr ? ` with value ${amountStr}` : ''} — may be relevant business context.`]
            )
            candidates++
          }
        }
      }

      if (contacts.length) {
        const contactLines = contacts.slice(0, 50).map(c => {
          const name    = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unknown'
          const details = [c.jobTitle, c.company].filter(Boolean).join(' @ ')
          return details ? `${name} (${details})` : name
        })
        const contactContent = [`HubSpot contacts (${contacts.length} total, top ${Math.min(50, contacts.length)} shown):`, ...contactLines].join('\n')
        await client.query(
          `INSERT INTO business_memory_search
             (tenant_id, source_type, source_ref, title, content, metadata, embedding_queued_at)
           VALUES ($1, 'integration', 'hubspot:contacts:snapshot', 'HubSpot contacts snapshot', $2, $3, now())
           ON CONFLICT (tenant_id, source_type, source_ref) DO UPDATE SET
             title               = EXCLUDED.title,
             content             = EXCLUDED.content,
             metadata            = EXCLUDED.metadata,
             embedding_queued_at = now(),
             updated_at          = now()`,
          [tenantId, contactContent, JSON.stringify({ provider: 'hubspot', contact_count: contacts.length, worker_id: workerId, sync_run_id: runId })]
        )
        ingested++
      }

      await client.query(
        `INSERT INTO business_memory_events
           (tenant_id, memory_layer, action, reason, actor_type, source_type, source_ref)
         VALUES ($1, 'search', 'sync_completed', $2, 'integration', 'hubspot', $3)`,
        [tenantId, `HubSpot sync: ${companies.length} companies, ${deals.length} deals, ${contacts.length} contacts — ${ingested} items updated, ${candidates} candidates created`, `grant:${grantId}`]
      )
    })

    await finaliseRun(runId, 'ok', ingested, candidates)
    await updateGrant(grantId, 'ok', ingested, null)
    return { ingested, candidates }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[connectorSync/hubspot] ${message}`)

    withTenant(tenantId, (client) => client.query(
      `INSERT INTO business_memory_events
         (tenant_id, memory_layer, action, reason, actor_type, source_type, source_ref)
       VALUES ($1, 'search', 'sync_failed', $2, 'integration', 'hubspot', $3)`,
      [tenantId, `HubSpot sync error: ${message}`, `grant:${grantId}`]
    )).catch(() => {/* non-fatal */})

    await finaliseRun(runId, 'error', ingested, candidates, message)
    await updateGrant(grantId, 'error', ingested, message)
    return { ingested, candidates, error: message }
  }
}

async function finaliseRun(
  runId: string,
  status: 'ok' | 'error',
  ingested: number,
  candidates: number,
  errorMessage?: string
) {
  await pool.query(
    `UPDATE connector_sync_runs
     SET status              = $1,
         items_ingested      = $2,
         candidates_created  = $3,
         error_message       = $4,
         finished_at         = now()
     WHERE id = $5`,
    [status, ingested, candidates, errorMessage ?? null, runId]
  )
}

async function updateGrant(
  grantId: string,
  syncStatus: 'ok' | 'error',
  count: number,
  errorMessage: string | null
) {
  await pool.query(
    `UPDATE tenant_data_source_grants
     SET last_synced_at   = now(),
         last_sync_status = $1,
         last_sync_count  = $2,
         last_sync_error  = $3,
         updated_at       = now()
     WHERE id = $4`,
    [syncStatus, count, errorMessage, grantId]
  )
}
