/**
 * Robin — environment config
 * Single place to read + validate all env vars
 */

export const env = {
  ANTHROPIC_KEY:       process.env.ANTHROPIC_KEY,
  REDIS_URL:           process.env.REDIS_URL,
  REDIS_TOKEN:         process.env.REDIS_TOKEN,
  BRAVE_KEY:           process.env.BRAVE_KEY,
  GOOGLE_MAPS_KEY:     process.env.GOOGLE_MAPS_KEY,
  OPENAI_KEY:          process.env.OPENAI_KEY,
  GMAIL_CLIENT_ID:     process.env.GMAIL_CLIENT_ID,
  GMAIL_CLIENT_SECRET: process.env.GMAIL_CLIENT_SECRET,
  GMAIL_REDIRECT_URI:  process.env.GMAIL_REDIRECT_URI || 'https://robin-agent.onrender.com/email/callback',
  PORT:                process.env.PORT || 3000,
  NODE_ENV:            process.env.NODE_ENV || 'development',
}

export function assertRequired() {
  const required = ['ANTHROPIC_KEY']
  const missing  = required.filter(k => !env[k])
  if (missing.length) {
    console.warn(`⚠️  Missing env vars: ${missing.join(', ')}`)
  }
}
