/**
 * Global error handler middleware
 */

import { logger } from '../lib/logger.js'

export function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.path} — ${err.message}`, { stack: err.stack })

  const status  = err.status || err.statusCode || 500
  const message = process.env.NODE_ENV === 'production' ? 'Something went wrong' : err.message

  res.status(status).json({ error: message })
}

export function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` })
}
