import express from 'express'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
import fs from 'fs'

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
      const scripts: string[] = []
      if (!html.includes('fen_auth.js'))
        scripts.push(`<script src="/frontend/fen_auth.js?v=${assetVersion}"></script>`)
      if (!html.includes('fen_mascot.js'))
        scripts.push(`<script src="/frontend/fen_mascot.js?v=${assetVersion}"></script>`)
      const skipBrand = ['fen_dashboard.html', 'fen_chat.html'].includes(req.params.file)
      if (!skipBrand && !html.includes('fen_brand_apply.js'))
        scripts.push(`<script src="/frontend/fen_brand_apply.js?v=${assetVersion}"></script>`)
      if (req.params.file === 'fen_site.html' && !html.includes('landing_copy_fix.js'))
        scripts.push(`<script src="/frontend/landing_copy_fix.js?v=${assetVersion}"></script>`)
      if (scripts.length) html = html.replace('</head>', `${scripts.join('')}</head>`)
      res.setHeader('Cache-Control', 'no-store')
      res.type('html').send(html)
    } catch (e) {
      next(e)
    }
  })

  app.use('/frontend', express.static(frontendDir, { maxAge: 0, etag: false }))

  // ── Health ────────────────────────────────────────────────────────────
  app.get('/health', (_, res) => res.json({ ok: true, service: 'fen-platform' }))

  // ── Routes ────────────────────────────────────────────────────────────
  app.use('/', authRouter)
  app.use('/', adminRouter)
  app.use('/', telegramRouter)
  app.use('/', billingRouter)
  app.use('/', approvalsRouter)
  app.use('/', gmailRouter)
  app.use('/', chatRouter)

  // ── Error handler ─────────────────────────────────────────────────────
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Error]', message)
    res.status(500).json({ error: message })
  })

  return app
}
