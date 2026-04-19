/**
 * Robin logger — structured console logging
 */

const isDev = process.env.NODE_ENV !== 'production'

function fmt(level, msg, data) {
  const ts = new Date().toISOString()
  if (data) {
    console[level === 'error' ? 'error' : 'log'](`[${ts}] [${level.toUpperCase()}] ${msg}`, data)
  } else {
    console[level === 'error' ? 'error' : 'log'](`[${ts}] [${level.toUpperCase()}] ${msg}`)
  }
}

export const logger = {
  info:  (msg, data) => fmt('info',  msg, data),
  warn:  (msg, data) => fmt('warn',  msg, data),
  error: (msg, data) => fmt('error', msg, data),
  debug: (msg, data) => isDev && fmt('debug', msg, data),
}
