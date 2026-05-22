import { pool }                             from '../db/pool.js'
import { syncGmailConnector,
         syncGdriveConnector,
         syncSlackConnector,
         syncHubspotConnector }            from './connectorSync.js'
import { decryptToken }                     from '../lib/encrypt.js'
import { validateEncryptionKey }            from '../lib/encrypt.js'
import { env }                              from '../config/env.js'

const APP_BASE = env.connectorCallbackBase
  || process.env.APP_BASE_URL
  || 'https://fen-agent.onrender.com'

function callbackUri(provider: string) {
  return `${APP_BASE}/connectors/callback/${provider}`
}

async function runDueConnectorSyncs() {
  // Find grants that are due: connected + sync_enabled + not synced in last interval
  const intervalMin = env.connectorSyncIntervalMin || 60
  const r = await pool.query(
    `SELECT g.id, g.tenant_id, g.worker_id, g.provider,
            g.access_token_enc, g.refresh_token_enc, g.token_expiry,
            COALESCE(tl.max_connector_syncs_per_day, 48) AS max_syncs,
            COALESCE(
              (SELECT COUNT(*) FROM connector_sync_runs csr
               WHERE csr.grant_id = g.id AND csr.started_at >= CURRENT_DATE AND csr.status != 'error'),
              0
            )::int AS syncs_today
     FROM tenant_data_source_grants g
     LEFT JOIN tenant_limits tl ON tl.tenant_id = g.tenant_id
     WHERE g.status      = 'connected'
       AND g.sync_enabled = true
       AND (
         g.last_synced_at IS NULL
         OR g.last_synced_at < now() - ($1 || ' minutes')::interval
       )`,
    [intervalMin]
  )

  if (!r.rows.length) return

  console.log(`[connectorScheduler] ${r.rows.length} grant(s) due for sync`)

  for (const grant of r.rows) {
    // Respect per-tenant sync quota
    if (Number(grant.syncs_today) >= Number(grant.max_syncs)) {
      console.log(`[connectorScheduler] tenant ${grant.tenant_id}: sync quota reached, skipping`)
      continue
    }

    try {
      const tokens = {
        access_token:  decryptToken(grant.access_token_enc),
        refresh_token: decryptToken(grant.refresh_token_enc),
        expiry_date:   grant.token_expiry,
      }
      const syncParams = {
        tenantId:    grant.tenant_id as string,
        workerId:    (grant.worker_id ?? '') as string,
        grantId:     grant.id as string,
        tokens,
        trigger:     'scheduled' as const,
        callbackUri: callbackUri(grant.provider),
      }

      if (grant.provider === 'gmail') {
        await syncGmailConnector(syncParams)
      } else if (grant.provider === 'gdrive') {
        await syncGdriveConnector(syncParams)
      } else if (grant.provider === 'slack') {
        await syncSlackConnector(syncParams)
      } else if (grant.provider === 'hubspot') {
        await syncHubspotConnector(syncParams)
      }
    } catch (err) {
      console.error(`[connectorScheduler] grant ${grant.id} error:`, err)
    }
  }
}

export function startConnectorScheduler() {
  // Validate encryption key at startup — hard-fails in production if key is missing/weak
  validateEncryptionKey()
  const intervalMin = env.connectorSyncIntervalMin || 60
  const ms = intervalMin * 60 * 1000

  // Stagger start by 2 minutes to avoid competing with startup tasks
  setTimeout(() => {
    runDueConnectorSyncs().catch(err =>
      console.error('[connectorScheduler] initial run error:', err)
    )
    setInterval(() => {
      runDueConnectorSyncs().catch(err =>
        console.error('[connectorScheduler] interval error:', err)
      )
    }, ms)
  }, 2 * 60 * 1000)

  console.log(`[connectorScheduler] scheduled every ${intervalMin} min`)
}
