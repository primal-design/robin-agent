import * as Sentry from '@sentry/node'
import express from 'express'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
import fs from 'fs'

import { env } from './config/env.js'

import { telegramRouter }  from './routes/telegram.js'
import { billingRouter }   from './routes/billing.js'
import { approvalsRouter } from './routes/approvals.js'
import chatRouter         from './routes/chat.js'
import gmailRouter        from './routes/gmail.js'
import authRouter         from './routes/auth.js'
import adminRouter        from './routes/admin.js'

export function createApp() {
  const app = express()

  // Raw body must be captured before json() for Stripe webhooks
  app.use('/billing/webhook', express.raw({ type: 'application/json' }))

  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: false }))
  app.use((_, res, next) => { res.removeHeader('Content-Security-Policy'); next() })

  // ── Frontend serving ──────────────────────────────────────────────────
  const frontendDir  = resolve(__dirname, '../../../frontend')
  const assetVersion = '20260430d'

  app.get('/frontend/:file', (req, res, next) => {
    const filePath = resolve(frontendDir, req.params.file)
    if (!filePath.endsWith('.html') || !fs.existsSync(filePath)) return next()

    try {
      let html = fs.readFileSync(filePath, 'utf-8')
      const headSnippets: string[] = []
      const scripts: string[] = []

      // Cloudflare Web Analytics
      if (env.cfBeaconToken && !html.includes('cf-beacon'))
        headSnippets.push(`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${env.cfBeaconToken}"}'></script>`)

      // PostHog
      if (env.posthogKey && !html.includes('posthog'))
        headSnippets.push(`<script>!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+" (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init("${env.posthogKey}",{api_host:"https://eu.i.posthog.com"})</script>`)

      // Sentry browser SDK (only if DSN is set)
      if (env.sentryDsn && !html.includes('sentry'))
        headSnippets.push(`<script src="https://browser.sentry-cdn.com/7.99.0/bundle.min.js" crossorigin="anonymous"></script><script>Sentry.init({dsn:"${env.sentryDsn}",environment:"${env.nodeEnv}",tracesSampleRate:0.2})</script>`)

      if (!html.includes('fen_auth.js'))
        scripts.push(`<script src="/frontend/fen_auth.js?v=${assetVersion}"></script>`)
      if (!html.includes('fen_mascot.js'))
        scripts.push(`<script src="/frontend/fen_mascot.js?v=${assetVersion}"></script>`)
      const skipBrand = ['fen_dashboard.html', 'fen_chat.html'].includes(req.params.file)
      if (!skipBrand && !html.includes('fen_brand_apply.js'))
        scripts.push(`<script src="/frontend/fen_brand_apply.js?v=${assetVersion}"></script>`)
      if (req.params.file === 'fen_site.html' && !html.includes('landing_copy_fix.js'))
        scripts.push(`<script src="/frontend/landing_copy_fix.js?v=${assetVersion}"></script>`)

      const inject = [...headSnippets, ...scripts]
      if (inject.length) html = html.replace('</head>', `${inject.join('')}</head>`)
      res.setHeader('Cache-Control', 'no-store')
      res.type('html').send(html)
    } catch (e) {
      next(e)
    }
  })

  app.use('/frontend', express.static(frontendDir, { maxAge: 0, etag: false }))

  // ── Health ────────────────────────────────────────────────────────────
  app.get('/health', (_, res) => res.json({ ok: true, service: 'fen-platform' }))

  // ── Sentry test ───────────────────────────────────────────────────────
  app.get('/debug-sentry', () => { throw new Error('Sentry test error from FEN API') })

  // ── Routes ────────────────────────────────────────────────────────────
  app.use('/', authRouter)
  app.use('/', adminRouter)
  app.use('/', telegramRouter)
  app.use('/', billingRouter)
  app.use('/', approvalsRouter)
  app.use('/', gmailRouter)
  app.use('/', chatRouter)

  // ── Error handler ─────────────────────────────────────────────────────
  if (env.sentryDsn) Sentry.setupExpressErrorHandler(app)

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Error]', message)
    res.status(500).json({ error: message })
  })

  return app
}
