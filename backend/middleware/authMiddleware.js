/**
 * Auth middleware — validates session token from Authorization header
 * or falls back to sessionId in body/query
 */

import { loadUser } from '../lib/db.js'

export function requireAuth(req, res, next) {
  // Try Bearer token first
  const authHeader = req.headers['authorization']
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7)
    // Token format: "sid_<sessionId>" — simple for now, swap for JWT later
    if (token.startsWith('sid_') || token.length > 8) {
      req.sessionId = token
      return next()
    }
    return res.status(401).json({ error: 'Invalid token' })
  }

  // Fall back to sessionId in body or query
  const sessionId = req.body?.sessionId || req.query?.sessionId || 'web-default'
  req.sessionId = sessionId
  next()
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers['authorization']
  if (authHeader?.startsWith('Bearer ')) {
    req.sessionId = authHeader.slice(7)
  } else {
    req.sessionId = req.body?.sessionId || req.query?.sessionId || 'web-default'
  }
  next()
}
