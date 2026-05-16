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

      // Sentry browser SDK — loads regardless of consent (error monitoring, no tracking)
      if (env.sentryDsn && !html.includes('sentry'))
        headSnippets.push(`<script src="https://browser.sentry-cdn.com/7.99.0/bundle.min.js" crossorigin="anonymous"></script><script>Sentry.init({dsn:"${env.sentryDsn}",environment:"${env.nodeEnv}",tracesSampleRate:0.2,sendDefaultPii:false})</script>`)

      // PostHog — cookieless anonymous mode, no consent required under GDPR
      // persistence:'memory' means no cookies, no localStorage tracking — anonymous sessions only
      // IP is masked server-side by PostHog EU cloud
      if (env.posthogKey && !html.includes('posthog'))
        headSnippets.push(`<script>(function(){var s=document.createElement('script');s.async=true;s.src='https://eu-assets.i.posthog.com/static/array.js';s.onload=function(){posthog.init('${env.posthogKey}',{api_host:'https://eu.i.posthog.com',persistence:'memory',autocapture:false,capture_pageview:true,disable_session_recording:true,ip:false})};document.head.appendChild(s)})();</script>`)

      // Cloudflare Web Analytics — cookie-free by design, no consent required
      if (env.cfBeaconToken && !html.includes('cf-beacon'))
        headSnippets.push(`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${env.cfBeaconToken}"}'></script>`)

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
