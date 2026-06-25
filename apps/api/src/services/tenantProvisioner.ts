import { pool } from '../db/pool.js'
import { env } from '../config/env.js'
import crypto from 'crypto'

// ── Get or create tenant for an email ────────────────────────────────────────

export async function getOrCreateTenantForEmail(email: string): Promise<string> {
  const lower = email.toLowerCase().trim()

  // Check if tenant already exists for this email
  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE LOWER(email) = $1 LIMIT 1`,
    [lower]
  )
  if (existing.rows[0]) return existing.rows[0].id

  // Create new tenant + default worker_channels row
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const tenantRes = await client.query<{ id: string }>(
      `INSERT INTO tenants (name, email)
       VALUES ($1, $2)
       RETURNING id`,
      [
        lower.split('@')[0],
        lower,
      ]
    )
    const tenantId = tenantRes.rows[0].id

    // Create Telegram worker channel (empty, waiting for connect)
    const workerId = env.defaultWorkerId
    if (workerId) {
      await client.query(
        `INSERT INTO worker_channels
           (tenant_id, worker_id, channel_type, status, public_config, encrypted_config)
         VALUES ($1, $2, 'telegram', 'pending', '{}', '{}')
         ON CONFLICT DO NOTHING`,
        [tenantId, workerId]
      )
    }

    await client.query('COMMIT')
    console.log(`[tenantProvisioner] Created tenant ${tenantId} for ${lower}`)
    return tenantId
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ── Generate a Telegram connect token ────────────────────────────────────────

export async function generateTelegramConnectToken(tenantId: string): Promise<string> {
  const token = crypto.randomBytes(16).toString('hex')
  await pool.query(
    `INSERT INTO telegram_connect_tokens (tenant_id, token)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [tenantId, token]
  )
  return token
}

// ── Resolve tenant from connect token (called by bot on /connect <token>) ────

export async function resolveTelegramConnectToken(token: string): Promise<string | null> {
  const r = await pool.query<{ tenant_id: string }>(
    `SELECT tenant_id FROM telegram_connect_tokens
     WHERE token = $1 AND NOT used AND expires_at > now()
     LIMIT 1`,
    [token]
  )
  return r.rows[0]?.tenant_id ?? null
}

export async function useTelegramConnectToken(token: string, chatId: number, botToken: string): Promise<string | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const r = await client.query<{ tenant_id: string }>(
      `UPDATE telegram_connect_tokens
       SET used = true
       WHERE token = $1 AND NOT used AND expires_at > now()
       RETURNING tenant_id`,
      [token]
    )
    const tenantId = r.rows[0]?.tenant_id
    if (!tenantId) { await client.query('ROLLBACK'); return null }

    // Link chat_id to this tenant's worker_channel
    await client.query(
      `UPDATE worker_channels
       SET public_config   = public_config || $1,
           encrypted_config = encrypted_config || $2,
           status          = 'active'
       WHERE tenant_id = $3 AND channel_type = 'telegram'`,
      [
        JSON.stringify({ chat_id: chatId }),
        JSON.stringify({ bot_token: botToken }),
        tenantId,
      ]
    )

    await client.query('COMMIT')
    return tenantId
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
