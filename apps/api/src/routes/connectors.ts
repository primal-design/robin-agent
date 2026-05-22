import { Router }                             from 'express'
import { pool }                              from '../db/pool.js'
import { requireAuth, requireEditor,
         assertTenantAccess }                from '../lib/auth.js'
import { getConnectorAuthUrl }               from '../lib/gmail.js'
import { getGdriveAuthUrl, getDriveUserEmail } from '../lib/gdrive.js'
import { getSlackAuthUrl, exchangeSlackCode }  from '../lib/slack.js'
import { getHubspotAuthUrl, exchangeHubspotCode,
         getHubspotConnectedAccount }        from '../lib/hubspot.js'
import { syncGmailConnector,
         syncGdriveConnector,
         syncSlackConnector,
         syncHubspotConnector }              from '../services/connectorSync.js'
import { encryptToken, decryptToken }        from '../lib/encrypt.js'
import { env }                               from '../config/env.js'

const router = Router()

const PROVIDER_LABELS: Record<string, string> = {
  gmail:    'Gmail',
  gdrive:   'Google Drive',
  slack:    'Slack',
  hubspot:  'HubSpot',
}

function callbackUri(provider: string) {
  const base = env.connectorCallbackBase
    || process.env.APP_BASE_URL
    || 'https://fen-agent.onrender.com'
  return `${base}/connectors/callback/${provider}`
}

function stateEncode(data: object) {
  return Buffer.from(JSON.stringify(data)).toString('base64url')
}

function stateDecode(raw: string): Record<string, string> | null {
  try { return JSON.parse(Buffer.from(raw, 'base64url').toString()) }
  catch { return null }
}

async function resolveTenantFromWorker(workerId: string): Promise<string | null> {
  const r = await pool.query('SELECT tenant_id FROM workers WHERE id=$1', [workerId])
  return r.rows[0]?.tenant_id ?? null
}

async function checkSyncQuota(tenantId: string): Promise<boolean> {
  const r = await pool.query(
    `SELECT COALESCE(tl.max_connector_syncs_per_day, 48) AS max_syncs,
            COUNT(csr.id) AS syncs_today
     FROM tenant_limits tl
     LEFT JOIN connector_sync_runs csr
       ON  csr.tenant_id = $1
       AND csr.started_at >= CURRENT_DATE
       AND csr.status != 'error'
     WHERE tl.tenant_id = $1
     GROUP BY tl.max_connector_syncs_per_day`,
    [tenantId]
  )
  if (!r.rows[0]) return true  // no limits row yet — allow
  return Number(r.rows[0].syncs_today) < Number(r.rows[0].max_syncs)
}

// GET /connectors?worker_id=
router.get('/connectors', requireAuth, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const r = await pool.query(
    `SELECT id, provider, status, connected_email, connected_by,
            sync_enabled, last_synced_at, last_sync_status, last_sync_error,
            last_sync_count, scopes, created_at, updated_at
     FROM tenant_data_source_grants
     WHERE tenant_id=$1
     ORDER BY created_at DESC`,
    [tenantId]
  )

  const connected = new Set(r.rows.map((g: any) => g.provider))
  const catalogue = Object.entries(PROVIDER_LABELS)
    .filter(([p]) => !connected.has(p))
    .map(([provider, label]) => ({ provider, label }))

  res.json({ grants: r.rows, catalogue })
})

// GET /connectors/connect/gmail?worker_id= — start OAuth (read-only scopes)
router.get('/connectors/connect/gmail', requireEditor, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const state = stateEncode({
    provider: 'gmail',
    tenantId,
    workerId: worker_id,
    phone:    req.actor!.phone,
  })

  const url = getConnectorAuthUrl(state, callbackUri('gmail'))
  res.redirect(url)
})

// GET /connectors/callback/gmail — OAuth callback (no auth header — browser redirect)
router.get('/connectors/callback/gmail', async (req, res) => {
  const { code, state: rawState, error } = req.query as Record<string, string>

  if (error) {
    return res.redirect(`/frontend/fen_dashboard.html?connector_error=${encodeURIComponent(error)}`)
  }
  if (!code || !rawState) return res.status(400).send('Missing code or state')

  const state = stateDecode(rawState)
  if (!state?.tenantId || !state?.workerId) return res.status(400).send('Invalid state')

  try {
    const { google } = await import('googleapis')
    const redirectUri = callbackUri('gmail')
    const auth = new google.auth.OAuth2(env.gmailClientId, env.gmailClientSecret, redirectUri)
    const { tokens } = await auth.getToken(code)

    auth.setCredentials(tokens)
    const gmail = google.gmail({ version: 'v1', auth })
    const profileRes = await gmail.users.getProfile({ userId: 'me' })
    const connectedEmail = profileRes.data.emailAddress ?? ''

    const scopes = (tokens.scope ?? 'https://www.googleapis.com/auth/gmail.readonly').split(' ').filter(Boolean)

    // Encrypt tokens before storing
    const accessEnc  = encryptToken(tokens.access_token ?? '')
    const refreshEnc = encryptToken(tokens.refresh_token ?? '')

    await pool.query(
      `INSERT INTO tenant_data_source_grants
         (tenant_id, worker_id, provider, status,
          access_token_enc, refresh_token_enc, token_expiry,
          scopes, connected_email, connected_by, sync_enabled)
       VALUES ($1,$2,'gmail','connected',$3,$4,$5,$6,$7,$8,true)
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         status            = 'connected',
         access_token_enc  = $3,
         refresh_token_enc = CASE WHEN $4 != '' THEN $4
                                  ELSE tenant_data_source_grants.refresh_token_enc END,
         token_expiry      = $5,
         scopes            = $6,
         connected_email   = $7,
         connected_by      = $8,
         sync_enabled      = true,
         updated_at        = now()`,
      [
        state.tenantId,
        state.workerId,
        accessEnc,
        refreshEnc,
        tokens.expiry_date,
        scopes,
        connectedEmail,
        state.phone ?? '',
      ]
    )

    res.redirect('/frontend/fen_dashboard.html?connector_connected=gmail')
  } catch (err) {
    console.error('[connector/gmail callback]', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    res.redirect(`/frontend/fen_dashboard.html?connector_error=${encodeURIComponent(msg)}`)
  }
})

// POST /connectors/gmail/sync — manual sync
router.post('/connectors/gmail/sync', requireEditor, async (req, res) => {
  const worker_id = (req.query.worker_id ?? req.body.worker_id) as string
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const withinQuota = await checkSyncQuota(tenantId)
  if (!withinQuota) return res.status(429).json({ error: 'sync_quota_exceeded' })

  const grantRes = await pool.query(
    `SELECT id, access_token_enc, refresh_token_enc, token_expiry
     FROM tenant_data_source_grants
     WHERE tenant_id=$1 AND provider='gmail' AND status='connected' AND sync_enabled=true`,
    [tenantId]
  )
  if (!grantRes.rows[0]) return res.status(404).json({ error: 'no_active_gmail_grant' })

  const grant = grantRes.rows[0]
  const tokens = {
    access_token:  decryptToken(grant.access_token_enc),
    refresh_token: decryptToken(grant.refresh_token_enc),
    expiry_date:   grant.token_expiry,
  }

  const result = await syncGmailConnector({
    tenantId,
    workerId: worker_id,
    grantId: grant.id,
    tokens,
    trigger: 'manual',
    callbackUri: callbackUri('gmail'),
  })
  res.json({ ok: !result.error, ...result })
})

// PATCH /connectors/gmail — toggle sync_enabled
router.patch('/connectors/gmail', requireEditor, async (req, res) => {
  const worker_id   = (req.query.worker_id ?? req.body.worker_id) as string
  const { sync_enabled } = req.body as { sync_enabled?: boolean }

  if (!worker_id)              return res.status(400).json({ error: 'worker_id required' })
  if (sync_enabled === undefined) return res.status(400).json({ error: 'sync_enabled required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  await pool.query(
    `UPDATE tenant_data_source_grants
     SET sync_enabled=$1, updated_at=now()
     WHERE tenant_id=$2 AND provider='gmail'`,
    [sync_enabled, tenantId]
  )
  res.json({ ok: true })
})

// DELETE /connectors/gmail?worker_id= — disconnect
router.delete('/connectors/gmail', requireEditor, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  // Null tokens, disable sync, preserve last_sync_error for diagnostics
  await pool.query(
    `UPDATE tenant_data_source_grants
     SET status           = 'disconnected',
         access_token_enc = NULL,
         refresh_token_enc = NULL,
         sync_enabled     = false,
         updated_at       = now()
     WHERE tenant_id=$1 AND provider='gmail'`,
    [tenantId]
  )
  res.json({ ok: true })
})

// GET /connectors/gmail/runs?worker_id= — sync run history
router.get('/connectors/gmail/runs', requireAuth, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const r = await pool.query(
    `SELECT id, provider, trigger, status, items_ingested, candidates_created,
            error_message, started_at, finished_at
     FROM connector_sync_runs
     WHERE tenant_id=$1 AND provider='gmail'
     ORDER BY started_at DESC LIMIT 20`,
    [tenantId]
  )
  res.json(r.rows)
})

// ── Google Drive routes ───────────────────────────────────────────────────────

// GET /connectors/connect/gdrive?worker_id=
router.get('/connectors/connect/gdrive', requireEditor, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const state = stateEncode({ provider: 'gdrive', tenantId, workerId: worker_id, phone: req.actor!.phone })
  res.redirect(getGdriveAuthUrl(state, callbackUri('gdrive')))
})

// GET /connectors/callback/gdrive — OAuth callback (browser redirect)
router.get('/connectors/callback/gdrive', async (req, res) => {
  const { code, state: rawState, error } = req.query as Record<string, string>

  if (error) return res.redirect(`/frontend/fen_dashboard.html?connector_error=${encodeURIComponent(error)}`)
  if (!code || !rawState) return res.status(400).send('Missing code or state')

  const state = stateDecode(rawState)
  if (!state?.tenantId || !state?.workerId) return res.status(400).send('Invalid state')

  try {
    const { google } = await import('googleapis')
    const redirectUri = callbackUri('gdrive')
    const auth = new google.auth.OAuth2(env.gmailClientId, env.gmailClientSecret, redirectUri)
    const { tokens } = await auth.getToken(code)

    auth.setCredentials(tokens)
    const connectedEmail = await getDriveUserEmail(tokens)
    const scopes = (tokens.scope ?? 'https://www.googleapis.com/auth/drive.readonly').split(' ').filter(Boolean)

    const accessEnc  = encryptToken(tokens.access_token ?? '')
    const refreshEnc = encryptToken(tokens.refresh_token ?? '')

    await pool.query(
      `INSERT INTO tenant_data_source_grants
         (tenant_id, worker_id, provider, status,
          access_token_enc, refresh_token_enc, token_expiry,
          scopes, connected_email, connected_by, sync_enabled)
       VALUES ($1,$2,'gdrive','connected',$3,$4,$5,$6,$7,$8,true)
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         status            = 'connected',
         access_token_enc  = $3,
         refresh_token_enc = CASE WHEN $4 != '' THEN $4
                                  ELSE tenant_data_source_grants.refresh_token_enc END,
         token_expiry      = $5,
         scopes            = $6,
         connected_email   = $7,
         connected_by      = $8,
         sync_enabled      = true,
         updated_at        = now()`,
      [state.tenantId, state.workerId, accessEnc, refreshEnc, tokens.expiry_date, scopes, connectedEmail, state.phone ?? '']
    )

    res.redirect('/frontend/fen_dashboard.html?connector_connected=gdrive')
  } catch (err) {
    console.error('[connector/gdrive callback]', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    res.redirect(`/frontend/fen_dashboard.html?connector_error=${encodeURIComponent(msg)}`)
  }
})

// POST /connectors/gdrive/sync
router.post('/connectors/gdrive/sync', requireEditor, async (req, res) => {
  const worker_id = (req.query.worker_id ?? req.body.worker_id) as string
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const withinQuota = await checkSyncQuota(tenantId)
  if (!withinQuota) return res.status(429).json({ error: 'sync_quota_exceeded' })

  const grantRes = await pool.query(
    `SELECT id, access_token_enc, refresh_token_enc, token_expiry
     FROM tenant_data_source_grants
     WHERE tenant_id=$1 AND provider='gdrive' AND status='connected' AND sync_enabled=true`,
    [tenantId]
  )
  if (!grantRes.rows[0]) return res.status(404).json({ error: 'no_active_gdrive_grant' })

  const grant  = grantRes.rows[0]
  const tokens = {
    access_token:  decryptToken(grant.access_token_enc),
    refresh_token: decryptToken(grant.refresh_token_enc),
    expiry_date:   grant.token_expiry,
  }

  const result = await syncGdriveConnector({
    tenantId, workerId: worker_id, grantId: grant.id,
    tokens, trigger: 'manual', callbackUri: callbackUri('gdrive'),
  })
  res.json({ ok: !result.error, ...result })
})

// PATCH /connectors/gdrive — toggle sync_enabled
router.patch('/connectors/gdrive', requireEditor, async (req, res) => {
  const worker_id   = (req.query.worker_id ?? req.body.worker_id) as string
  const { sync_enabled } = req.body as { sync_enabled?: boolean }

  if (!worker_id)              return res.status(400).json({ error: 'worker_id required' })
  if (sync_enabled === undefined) return res.status(400).json({ error: 'sync_enabled required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  await pool.query(
    `UPDATE tenant_data_source_grants SET sync_enabled=$1, updated_at=now()
     WHERE tenant_id=$2 AND provider='gdrive'`,
    [sync_enabled, tenantId]
  )
  res.json({ ok: true })
})

// DELETE /connectors/gdrive?worker_id= — disconnect
router.delete('/connectors/gdrive', requireEditor, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  await pool.query(
    `UPDATE tenant_data_source_grants
     SET status='disconnected', access_token_enc=NULL, refresh_token_enc=NULL,
         sync_enabled=false, updated_at=now()
     WHERE tenant_id=$1 AND provider='gdrive'`,
    [tenantId]
  )
  res.json({ ok: true })
})

// GET /connectors/gdrive/runs?worker_id=
router.get('/connectors/gdrive/runs', requireAuth, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const r = await pool.query(
    `SELECT id, provider, trigger, status, items_ingested, candidates_created,
            error_message, started_at, finished_at
     FROM connector_sync_runs
     WHERE tenant_id=$1 AND provider='gdrive'
     ORDER BY started_at DESC LIMIT 20`,
    [tenantId]
  )
  res.json(r.rows)
})

// ── Slack routes ──────────────────────────────────────────────────────────────

// GET /connectors/connect/slack?worker_id=
router.get('/connectors/connect/slack', requireEditor, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })
  if (!env.slackClientId) return res.status(503).json({ error: 'slack_not_configured' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const state = stateEncode({ provider: 'slack', tenantId, workerId: worker_id, phone: req.actor!.phone })
  res.redirect(getSlackAuthUrl(state, callbackUri('slack')))
})

// GET /connectors/callback/slack — Slack OAuth callback (browser redirect, no auth header)
router.get('/connectors/callback/slack', async (req, res) => {
  const { code, state: rawState, error } = req.query as Record<string, string>

  if (error) return res.redirect(`/frontend/fen_dashboard.html?connector_error=${encodeURIComponent(error)}`)
  if (!code || !rawState) return res.status(400).send('Missing code or state')

  const state = stateDecode(rawState)
  if (!state?.tenantId || !state?.workerId) return res.status(400).send('Invalid state')

  try {
    const result = await exchangeSlackCode(code, callbackUri('slack'))

    // Slack bot tokens don't expire — store token only in access_token_enc, no refresh
    const accessEnc = encryptToken(result.access_token)
    const identity  = `${result.team_name} (${result.team_id})`

    await pool.query(
      `INSERT INTO tenant_data_source_grants
         (tenant_id, worker_id, provider, status,
          access_token_enc, refresh_token_enc, token_expiry,
          scopes, connected_email, connected_by, sync_enabled)
       VALUES ($1,$2,'slack','connected',$3,NULL,NULL,$4,$5,$6,true)
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         status           = 'connected',
         access_token_enc = $3,
         scopes           = $4,
         connected_email  = $5,
         connected_by     = $6,
         sync_enabled     = true,
         updated_at       = now()`,
      [
        state.tenantId,
        state.workerId,
        accessEnc,
        ['channels:read', 'channels:history', 'users:read'],
        identity,
        state.phone ?? '',
      ]
    )

    res.redirect('/frontend/fen_dashboard.html?connector_connected=slack')
  } catch (err) {
    console.error('[connector/slack callback]', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    res.redirect(`/frontend/fen_dashboard.html?connector_error=${encodeURIComponent(msg)}`)
  }
})

// POST /connectors/slack/sync
router.post('/connectors/slack/sync', requireEditor, async (req, res) => {
  const worker_id = (req.query.worker_id ?? req.body.worker_id) as string
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const withinQuota = await checkSyncQuota(tenantId)
  if (!withinQuota) return res.status(429).json({ error: 'sync_quota_exceeded' })

  const grantRes = await pool.query(
    `SELECT id, access_token_enc FROM tenant_data_source_grants
     WHERE tenant_id=$1 AND provider='slack' AND status='connected' AND sync_enabled=true`,
    [tenantId]
  )
  if (!grantRes.rows[0]) return res.status(404).json({ error: 'no_active_slack_grant' })

  const grant = grantRes.rows[0]
  const result = await syncSlackConnector({
    tenantId, workerId: worker_id, grantId: grant.id,
    tokens: { access_token: decryptToken(grant.access_token_enc), refresh_token: '', expiry_date: null },
    trigger: 'manual', callbackUri: callbackUri('slack'),
  })
  res.json({ ok: !result.error, ...result })
})

// PATCH /connectors/slack — toggle sync_enabled
router.patch('/connectors/slack', requireEditor, async (req, res) => {
  const worker_id   = (req.query.worker_id ?? req.body.worker_id) as string
  const { sync_enabled } = req.body as { sync_enabled?: boolean }
  if (!worker_id)              return res.status(400).json({ error: 'worker_id required' })
  if (sync_enabled === undefined) return res.status(400).json({ error: 'sync_enabled required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })
  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  await pool.query(
    `UPDATE tenant_data_source_grants SET sync_enabled=$1, updated_at=now()
     WHERE tenant_id=$2 AND provider='slack'`,
    [sync_enabled, tenantId]
  )
  res.json({ ok: true })
})

// DELETE /connectors/slack?worker_id=
router.delete('/connectors/slack', requireEditor, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })
  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  await pool.query(
    `UPDATE tenant_data_source_grants
     SET status='disconnected', access_token_enc=NULL, sync_enabled=false, updated_at=now()
     WHERE tenant_id=$1 AND provider='slack'`,
    [tenantId]
  )
  res.json({ ok: true })
})

// GET /connectors/slack/runs?worker_id=
router.get('/connectors/slack/runs', requireAuth, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })
  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const r = await pool.query(
    `SELECT id, provider, trigger, status, items_ingested, candidates_created,
            error_message, started_at, finished_at
     FROM connector_sync_runs
     WHERE tenant_id=$1 AND provider='slack'
     ORDER BY started_at DESC LIMIT 20`,
    [tenantId]
  )
  res.json(r.rows)
})

// ── HubSpot routes ────────────────────────────────────────────────────────────

// GET /connectors/connect/hubspot?worker_id=
router.get('/connectors/connect/hubspot', requireEditor, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })
  if (!env.hubspotClientId) return res.status(503).json({ error: 'hubspot_not_configured' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const state = stateEncode({ provider: 'hubspot', tenantId, workerId: worker_id, phone: req.actor!.phone })
  res.redirect(getHubspotAuthUrl(state, callbackUri('hubspot')))
})

// GET /connectors/callback/hubspot — OAuth callback (browser redirect, no auth header)
router.get('/connectors/callback/hubspot', async (req, res) => {
  const { code, state: rawState, error } = req.query as Record<string, string>

  if (error) return res.redirect(`/frontend/fen_dashboard.html?connector_error=${encodeURIComponent(error)}`)
  if (!code || !rawState) return res.status(400).send('Missing code or state')

  const state = stateDecode(rawState)
  if (!state?.tenantId || !state?.workerId) return res.status(400).send('Invalid state')

  try {
    const result       = await exchangeHubspotCode(code, callbackUri('hubspot'))
    const connectedAs  = await getHubspotConnectedAccount(result.access_token)

    const accessEnc  = encryptToken(result.access_token)
    const refreshEnc = encryptToken(result.refresh_token)

    await pool.query(
      `INSERT INTO tenant_data_source_grants
         (tenant_id, worker_id, provider, status,
          access_token_enc, refresh_token_enc, token_expiry,
          scopes, connected_email, connected_by, sync_enabled)
       VALUES ($1,$2,'hubspot','connected',$3,$4,$5,$6,$7,$8,true)
       ON CONFLICT (tenant_id, provider) DO UPDATE SET
         status            = 'connected',
         access_token_enc  = $3,
         refresh_token_enc = $4,
         token_expiry      = $5,
         scopes            = $6,
         connected_email   = $7,
         connected_by      = $8,
         sync_enabled      = true,
         updated_at        = now()`,
      [
        state.tenantId,
        state.workerId,
        accessEnc,
        refreshEnc,
        result.expiry_date,
        ['crm.objects.contacts.read', 'crm.objects.companies.read', 'crm.objects.deals.read'],
        connectedAs,
        state.phone ?? '',
      ]
    )

    res.redirect('/frontend/fen_dashboard.html?connector_connected=hubspot')
  } catch (err) {
    console.error('[connector/hubspot callback]', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    res.redirect(`/frontend/fen_dashboard.html?connector_error=${encodeURIComponent(msg)}`)
  }
})

// POST /connectors/hubspot/sync
router.post('/connectors/hubspot/sync', requireEditor, async (req, res) => {
  const worker_id = (req.query.worker_id ?? req.body.worker_id) as string
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })

  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const withinQuota = await checkSyncQuota(tenantId)
  if (!withinQuota) return res.status(429).json({ error: 'sync_quota_exceeded' })

  const grantRes = await pool.query(
    `SELECT id, access_token_enc, refresh_token_enc, token_expiry
     FROM tenant_data_source_grants
     WHERE tenant_id=$1 AND provider='hubspot' AND status='connected' AND sync_enabled=true`,
    [tenantId]
  )
  if (!grantRes.rows[0]) return res.status(404).json({ error: 'no_active_hubspot_grant' })

  const grant  = grantRes.rows[0]
  const tokens = {
    access_token:  decryptToken(grant.access_token_enc),
    refresh_token: decryptToken(grant.refresh_token_enc),
    expiry_date:   grant.token_expiry,
  }

  const result = await syncHubspotConnector({
    tenantId, workerId: worker_id, grantId: grant.id,
    tokens, trigger: 'manual', callbackUri: callbackUri('hubspot'),
  })
  res.json({ ok: !result.error, ...result })
})

// PATCH /connectors/hubspot — toggle sync_enabled
router.patch('/connectors/hubspot', requireEditor, async (req, res) => {
  const worker_id   = (req.query.worker_id ?? req.body.worker_id) as string
  const { sync_enabled } = req.body as { sync_enabled?: boolean }
  if (!worker_id)                return res.status(400).json({ error: 'worker_id required' })
  if (sync_enabled === undefined) return res.status(400).json({ error: 'sync_enabled required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })
  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  await pool.query(
    `UPDATE tenant_data_source_grants SET sync_enabled=$1, updated_at=now()
     WHERE tenant_id=$2 AND provider='hubspot'`,
    [sync_enabled, tenantId]
  )
  res.json({ ok: true })
})

// DELETE /connectors/hubspot?worker_id=
router.delete('/connectors/hubspot', requireEditor, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })
  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  await pool.query(
    `UPDATE tenant_data_source_grants
     SET status='disconnected', access_token_enc=NULL, refresh_token_enc=NULL,
         sync_enabled=false, updated_at=now()
     WHERE tenant_id=$1 AND provider='hubspot'`,
    [tenantId]
  )
  res.json({ ok: true })
})

// GET /connectors/hubspot/runs?worker_id=
router.get('/connectors/hubspot/runs', requireAuth, async (req, res) => {
  const { worker_id } = req.query as Record<string, string>
  if (!worker_id) return res.status(400).json({ error: 'worker_id required' })

  const tenantId = await resolveTenantFromWorker(worker_id)
  if (!tenantId) return res.status(404).json({ error: 'not_found' })
  const hasAccess = await assertTenantAccess(req.actor!.phone, tenantId)
  if (!hasAccess) return res.status(403).json({ error: 'tenant_access_denied' })

  const r = await pool.query(
    `SELECT id, provider, trigger, status, items_ingested, candidates_created,
            error_message, started_at, finished_at
     FROM connector_sync_runs
     WHERE tenant_id=$1 AND provider='hubspot'
     ORDER BY started_at DESC LIMIT 20`,
    [tenantId]
  )
  res.json(r.rows)
})

export default router
