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
}

export function assertRequired() {
  const missing = ['ANTHROPIC_KEY', 'DATABASE_URL'].filter(k => !process.env[k])
  if (missing.length) console.warn(`⚠️  Missing env vars: ${missing.join(', ')}`)
}
