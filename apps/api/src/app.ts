import * as Sentry from '@sentry/node'
import express from 'express'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
import fs from 'fs'

import { env } from './config/env.js'

import { telegramRouter } from './routes/telegram.js'
import authRouter        from './routes/auth.js'
import adminRouter       from './routes/admin.js'
import provisionRouter   from './routes/provision.js'
import channelsRouter    from './routes/channels.js'
import schedulerRouter   from './routes/scheduler.js'
import profileRouter     from './routes/profile.js'
import jobsRouter        from './routes/jobs.js'
import matchesRouter     from './routes/matches.js'
import { publicRateLimit, authRateLimit, dashboardRateLimit, chatRateLimit } from './middleware/rateLimit.js'

export function createApp() {
  const app = express()

  app.set('trust proxy', 1)

  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: false }))
  app.use((_, res, next) => { res.removeHeader('Content-Security-Policy'); next() })

  // ── Rate limiting ─────────────────────────────────────────────────────
  app.use('/auth/', authRateLimit)
  app.use('/agent/', dashboardRateLimit)
  app.use('/approvals/', dashboardRateLimit)
  app.use('/chat', chatRateLimit)
  app.use('/telegram/', chatRateLimit)
  app.use('/', publicRateLimit)

  // ── Frontend serving ──────────────────────────────────────────────────
  const frontendDir  = resolve(__dirname, '../../../frontend')
  const assetVersion = '20260627a'

  app.get('/frontend/:file', (req, res, next) => {
    const filePath = resolve(frontendDir, req.params.file)
    if (!filePath.endsWith('.html') || !fs.existsSync(filePath)) return next()

    try {
      let html = fs.readFileSync(filePath, 'utf-8')
      const headSnippets: string[] = []
      const scripts: string[] = []

      if (env.sentryDsn && !html.includes('sentry'))
        headSnippets.push(`<script src="https://browser.sentry-cdn.com/7.99.0/bundle.min.js" crossorigin="anonymous"></script><script>Sentry.init({dsn:"${env.sentryDsn}",environment:"${env.nodeEnv}",tracesSampleRate:0.2,sendDefaultPii:false})</script>`)

      if (env.posthogKey && !html.includes('posthog'))
        headSnippets.push(`<script>(function(){var s=document.createElement('script');s.async=true;s.src='https://eu-assets.i.posthog.com/static/array.js';s.onload=function(){posthog.init('${env.posthogKey}',{api_host:'https://eu.i.posthog.com',persistence:'memory',autocapture:false,capture_pageview:true,disable_session_recording:true,ip:false})};document.head.appendChild(s)})();</script>`)

      if (env.cfBeaconToken && !html.includes('cf-beacon'))
        headSnippets.push(`<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${env.cfBeaconToken}"}'></script>`)

      if (!html.includes('robin_auth.js'))
        scripts.push(`<script src="/frontend/robin_auth.js?v=${assetVersion}"></script>`)
      if (!html.includes('robin_mascot.js'))
        scripts.push(`<script src="/frontend/robin_mascot.js?v=${assetVersion}"></script>`)
      if (!['fen_dashboard.html'].includes(req.params.file) && !html.includes('robin_brand_apply.js'))
        scripts.push(`<script src="/frontend/robin_brand_apply.js?v=${assetVersion}"></script>`)
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

  // ── React SPA ─────────────────────────────────────────────────────────
  const reactDist = resolve(__dirname, '../../../apps/web/dist')
  if (fs.existsSync(reactDist)) {
    app.use('/app', express.static(reactDist, { maxAge: '1d' }))
    app.use('/assets', express.static(resolve(reactDist, 'assets'), { maxAge: '7d', immutable: true }))
    // SPA fallback: all /app/* routes return index.html
    app.get(['/app', '/app/*', '/sign-in', '/auth/callback'], (_req, res) => {
      res.sendFile(resolve(reactDist, 'index.html'))
    })
  }

  // ── Health ────────────────────────────────────────────────────────────
  app.get('/health', (_, res) => res.json({ ok: true, service: 'fen-platform' }))

  // ── Routes ────────────────────────────────────────────────────────────
  app.use('/', authRouter)
  app.use('/', adminRouter)
  app.use('/', provisionRouter)
  app.use('/', channelsRouter)
  app.use('/', schedulerRouter)
  app.use('/', profileRouter)
  app.use('/', jobsRouter)
  app.use('/', matchesRouter)
  app.use('/', telegramRouter)

  // ── Error handler ─────────────────────────────────────────────────────
  if (env.sentryDsn) Sentry.setupExpressErrorHandler(app)

  app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error'
    const pg = err as Record<string, unknown>
    if (pg?.code) {
      console.error(`[Error] ${req.method} ${req.path} — pg ${pg.code}: ${message}`, pg.detail ?? '', pg.hint ?? '')
    } else {
      console.error(`[Error] ${req.method} ${req.path}`, message)
    }
    res.status(500).json({ error: message })
  })

  return app
}
