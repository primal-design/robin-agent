import * as Sentry from '@sentry/node'
import { env } from './config/env.js'

if (env.sentryDsn) {
  Sentry.init({
    dsn: env.sentryDsn,
    environment: env.nodeEnv,
    enableLogs: true,
    tracesSampleRate: 0.2,
    sendDefaultPii: false,
  })
}
