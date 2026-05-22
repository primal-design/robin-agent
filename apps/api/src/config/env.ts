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
  telegramBotToken:   process.env.TELEGRAM_BOT_TOKEN ?? '',
  gmailClientId:      process.env.GMAIL_CLIENT_ID ?? '',
  gmailClientSecret:  process.env.GMAIL_CLIENT_SECRET ?? '',
  gmailRedirectUri:   process.env.GMAIL_REDIRECT_URI ?? 'https://fen-agent.onrender.com/email/callback',
  jwtSecret:          process.env.JWT_SECRET ?? 'dev-secret-change-me',
  robinAuthSecret:    process.env.ROBIN_AUTH_SECRET ?? process.env.SESSION_SECRET ?? '',
  adminToken:         process.env.ADMIN_TOKEN ?? '',
  youtubeKey:         process.env.YOUTUBE_API_KEY ?? '',
  apolloKey:          process.env.APOLLO_API_KEY ?? '',
  hunterKey:          process.env.HUNTER_API_KEY ?? '',
  newsApiKey:         process.env.NEWS_API_KEY ?? '',
  tomorrowKey:        process.env.TOMORROW_API_KEY ?? '',
  nhsApiKey:          process.env.NHS_API_KEY ?? '',
  tflAppKey:          process.env.TFL_APP_KEY ?? '',
  bodsApiKey:         process.env.BODS_API_KEY ?? '',
  githubToken:        process.env.GITHUB_TOKEN ?? '',
  stackAppKey:        process.env.STACKOVERFLOW_KEY ?? '',
  stripeSecretKey:    process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret:process.env.STRIPE_WEBHOOK_SECRET ?? '',
  stripeStarterPrice: process.env.STRIPE_STARTER_PRICE_ID ?? '',
  redisUrl:           process.env.REDIS_URL ?? '',
  defaultWorkerId:    process.env.DEFAULT_WORKER_ID ?? '',
  defaultTenantId:    process.env.DEFAULT_TENANT_ID ?? '',
  sentryDsn:          process.env.SENTRY_DSN ?? '',
  posthogKey:         process.env.POSTHOG_KEY ?? '',
  cfBeaconToken:           process.env.CF_BEACON_TOKEN ?? '',
  connectorCallbackBase:    process.env.CONNECTOR_CALLBACK_BASE ?? '',
  connectorEncryptionKey:   process.env.CONNECTOR_ENCRYPTION_KEY ?? '',
  connectorEncryptionKeyId: process.env.CONNECTOR_ENCRYPTION_KEY_ID ?? '1',
  connectorSyncIntervalMin: Number(process.env.CONNECTOR_SYNC_INTERVAL_MIN ?? '60'),
  slackClientId:            process.env.SLACK_CLIENT_ID ?? '',
  slackClientSecret:        process.env.SLACK_CLIENT_SECRET ?? '',
  hubspotClientId:          process.env.HUBSPOT_CLIENT_ID ?? '',
  hubspotClientSecret:      process.env.HUBSPOT_CLIENT_SECRET ?? '',
  voyageKey:                process.env.VOYAGE_API_KEY ?? '',
}

export function assertRequired() {
  const missing = ['ANTHROPIC_KEY', 'DATABASE_URL'].filter(k => !process.env[k])
  if (missing.length) console.warn(`⚠️  Missing env vars: ${missing.join(', ')}`)

  if (env.nodeEnv === 'production') {
    if (env.jwtSecret === 'dev-secret-change-me') {
      console.warn('⚠️  JWT_SECRET is using the development default')
    }
    if (!env.adminToken) {
      console.warn('⚠️  ADMIN_TOKEN is not configured')
    }

    // Connector token encryption — hard fail in production when Gmail/Drive is configured
    if (env.gmailClientId) {
      const k = env.connectorEncryptionKey
      if (!k) {
        console.error('❌ FATAL: CONNECTOR_ENCRYPTION_KEY must be set in production when Gmail/Drive connectors are enabled.')
        console.error('   Generate with: openssl rand -hex 32')
        process.exit(1)
      }
      if (k.length !== 64 && k.length < 32) {
        console.error('❌ FATAL: CONNECTOR_ENCRYPTION_KEY must be a 64-char hex string (openssl rand -hex 32) or at least 32 characters.')
        process.exit(1)
      }
    }
  }
}
