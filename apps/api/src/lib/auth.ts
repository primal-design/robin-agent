import { createHmac, timingSafeEqual } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env.js'
import { pool } from '../db/pool.js'

interface SessionPayload {
  phone: string
  iat: number
  exp: number
}

export interface AuthActor {
  phone: string
  role: string
}

declare global {
  namespace Express {
    interface Request {
      actor?: AuthActor
    }
  }
}

// ── JWT-style tokens (lib/auth.ts createSessionToken) ────────────────────────

function b64url(input: string | Buffer) {
  return Buffer.from(input).toString('base64url')
}

function sign(data: string) {
  return createHmac('sha256', env.jwtSecret).update(data).digest('base64url')
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function createSessionToken(phone: string, ttlSeconds = 60 * 60 * 24 * 30) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify({ phone, iat: now, exp: now + ttlSeconds }))
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`
}

export function verifySessionToken(token: string): SessionPayload | null {
  try {
    const [header, payload, signature] = token.split('.')
    if (!header || !payload || !signature) return null
    if (!safeEqual(signature, sign(`${header}.${payload}`))) return null
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as SessionPayload
    if (!decoded.phone || !decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) return null
    return decoded
  } catch {
    return null
  }
}

// ── rt_ tokens (routes/auth.ts createToken format) ───────────────────────────

function rtSecret() {
  return env.robinAuthSecret || env.jwtSecret
}

function rtSign(payload: string) {
  return createHmac('sha256', rtSecret()).update(payload).digest('base64url')
}

export function verifyRtToken(raw: string): { phone: string; type: string } | null {
  if (!raw.startsWith('rt_')) return null
  const [payload, sig] = raw.slice(3).split('.')
  if (!payload || !sig) return null
  const expected = rtSign(payload)
  if (!safeEqual(sig, expected)) return null
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    if (!data.phone || !data.exp || Number(data.exp) <= Date.now()) return null
    return { phone: data.phone, type: data.type }
  } catch {
    return null
  }
}

// ── Token extraction — accepts both formats ───────────────────────────────────

function extractPhone(authorization: string): string | null {
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) return null
  if (token.startsWith('rt_')) return verifyRtToken(token)?.phone ?? null
  return verifySessionToken(token)?.phone ?? null
}

// ── Middleware ────────────────────────────────────────────────────────────────

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const phone = extractPhone(req.headers.authorization || '')
  if (!phone) return res.status(401).json({ error: 'authentication_required' })
  req.actor = { phone, role: 'user' }
  next()
}

// Looks up role from DB and attaches to req.actor; falls back to 'user' if lookup fails
export async function requireAuthWithRole(req: Request, res: Response, next: NextFunction) {
  const phone = extractPhone(req.headers.authorization || '')
  if (!phone) return res.status(401).json({ error: 'authentication_required' })
  try {
    const r = await pool.query(`SELECT role FROM waitlist WHERE phone=$1 LIMIT 1`, [phone])
    req.actor = { phone, role: r.rows[0]?.role || 'user' }
  } catch {
    req.actor = { phone, role: 'user' }
  }
  next()
}

// Require admin or editor role for mutating dashboard routes
export async function requireEditor(req: Request, res: Response, next: NextFunction) {
  const phone = extractPhone(req.headers.authorization || '')
  if (!phone) return res.status(401).json({ error: 'authentication_required' })
  try {
    const r = await pool.query(`SELECT role FROM waitlist WHERE phone=$1 LIMIT 1`, [phone])
    const role: string = r.rows[0]?.role || 'user'
    if (!['admin', 'editor', 'owner'].includes(role)) {
      return res.status(403).json({ error: 'insufficient_permission', required: 'editor' })
    }
    req.actor = { phone, role }
    next()
  } catch (err) {
    next(err)
  }
}

// assertTenantAccess — verify that a phone number has access to a given tenant.
// Checks via users+memberships first; falls back to allowing platform editors
// on the DEFAULT_TENANT when memberships are not yet populated (single-tenant setup).
// Returns true if access is granted, false otherwise.
export async function assertTenantAccess(phone: string, tenantId: string): Promise<boolean> {
  // Primary check: explicit membership
  const memberRes = await pool.query(
    `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE u.phone_e164 = $1 AND m.tenant_id = $2 LIMIT 1`,
    [phone, tenantId]
  )
  if (memberRes.rows.length > 0) return true

  // Fallback: allow platform-level editors access to DEFAULT_TENANT only.
  // This covers single-tenant deployments where memberships are not populated.
  const defaultTenantId = process.env.DEFAULT_TENANT_ID ?? ''
  if (tenantId !== defaultTenantId) return false

  const waitlistRes = await pool.query(
    `SELECT role FROM waitlist WHERE phone = $1
     AND role IN ('admin', 'editor', 'owner') LIMIT 1`,
    [phone]
  )
  return waitlistRes.rows.length > 0
}

export function phoneFromBearer(authorization = '') {
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) return ''
  if (token.startsWith('rt_')) return verifyRtToken(token)?.phone ?? ''
  return verifySessionToken(token)?.phone ?? ''
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!env.adminToken || token !== env.adminToken) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}
