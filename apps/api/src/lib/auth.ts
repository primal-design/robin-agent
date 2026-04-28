import { createHmac, timingSafeEqual } from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { env } from '../config/env.js'

interface SessionPayload {
  phone: string
  iat: number
  exp: number
}

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

export function phoneFromBearer(authorization = '') {
  const token = authorization.replace(/^Bearer\s+/i, '').trim()
  if (!token) return ''
  return verifySessionToken(token)?.phone || ''
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim()
  if (!env.adminToken || token !== env.adminToken) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}
