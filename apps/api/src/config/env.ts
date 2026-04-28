import { config } from 'dotenv'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

// Load .env from repo root regardless of cwd
const root = resolve(fileURLToPath(import.meta.url), '../../../../../')
config({ path: resolve(root, '.env') })

export const env = {
  port:               Number(process.env.PORT ?? 3000),
  nodeEnv:            process.env.NODE_ENV ?? 'development',
  databaseUrl:        process.env.DATABASE_URL ?? '',
  anthropicKey:       process.env.ANTHROPIC_KEY ?? '',
  braveKey:           process.env.BRAVE_KEY ?? '',
  googleMapsKey:      process.env.GOOGLE_MAPS_KEY ?? '',
  twilioAccountSid:   process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken:    process.env.TWILIO_AUTH_TOKEN ?? '',
  twilioWhatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? 'whatsapp:+14155238886',
  gmailClientId:      process.env.GMAIL_CLIENT_ID ?? '',
  gmailClientSecret:  process.env.GMAIL_CLIENT_SECRET ?? '',
  gmailRedirectUri:   process.env.GMAIL_REDIRECT_URI ?? 'https://robin-agent.onrender.com/email/callback',
  jwtSecret:          process.env.JWT_SECRET ?? 'dev-secret-change-me',
  adminToken:         process.env.ADMIN_TOKEN ?? '',
  youtubeKey:         process.env.YOUTUBE_API_KEY ?? '',
  apolloKey:          process.env.APOLLO_API_KEY ?? '',
  hunterKey:          process.env.HUNTER_API_KEY ?? '',
  newsApiKey:         process.env.NEWS_API_KEY ?? '',
  tomorrowKey:        process.env.TOMORROW_API_KEY ?? '',
}

export function assertRequired() {
  const missing = ['ANTHROPIC_KEY', 'DATABASE_URL'].filter(k => !process.env[k])
  if (missing.length) console.warn(`⚠️  Missing env vars: ${missing.join(', ')}`)
  if (env.nodeEnv === 'production' && env.jwtSecret === 'dev-secret-change-me') {
    console.warn('⚠️  JWT_SECRET is using the development default')
  }
  if (env.nodeEnv === 'production' && !env.adminToken) {
    console.warn('⚠️  ADMIN_TOKEN is not configured')
  }
}
