/**
 * Simple in-memory rate limiter
 * For production, swap with Redis-backed rate limiting
 */

const store = new Map() // key → { count, resetAt }

export function rateLimit({ windowMs = 60_000, max = 30, key = 'ip' } = {}) {
  return (req, res, next) => {
    const id     = key === 'ip' ? (req.ip || 'unknown') : (req.sessionId || req.body?.sessionId || 'unknown')
    const now    = Date.now()
    const record = store.get(id)

    if (!record || now > record.resetAt) {
      store.set(id, { count: 1, resetAt: now + windowMs })
      return next()
    }

    if (record.count >= max) {
      return res.status(429).json({ error: 'Too many requests — slow down 🦊' })
    }

    record.count++
    next()
  }
}

export const chatLimit  = rateLimit({ windowMs: 60_000, max: 20, key: 'session' })
export const globalLimit = rateLimit({ windowMs: 60_000, max: 60, key: 'ip' })
