import express from 'express'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
import whatsappRouter from './routes/whatsapp.js'
import chatRouter     from './routes/chat.js'
import gmailRouter    from './routes/gmail.js'
import authRouter     from './routes/auth.js'
import fs from 'fs'

export function createApp() {
  const app = express()

  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: false }))
  app.use((_, res, next) => { res.removeHeader('Content-Security-Policy'); next() })

  const frontendDir = resolve(__dirname, '../../../frontend')

  app.get('/frontend/:file', (req, res, next) => {
    const filePath = resolve(frontendDir, req.params.file)
    if (!filePath.endsWith('.html') || !fs.existsSync(filePath)) return next()

    try {
      let html = fs.readFileSync(filePath, 'utf-8')
      const scripts: string[] = []
      if (!html.includes('robin_auth.js')) scripts.push('<script src="/frontend/robin_auth.js"></script>')
      if (req.params.file === 'robin_site.html' && !html.includes('landing_copy_fix.js')) scripts.push('<script src="/frontend/landing_copy_fix.js"></script>')
      if (!html.includes('robin_mascot.js')) scripts.push('<script src="/frontend/robin_mascot.js"></script>')
      if (scripts.length) html = html.replace('</head>', `${scripts.join('')}</head>`)
      res.type('html').send(html)
    } catch (e) {
      next(e)
    }
  })

  app.use('/frontend', express.static(frontendDir))

  app.get('/health', (_, res) => res.json({ ok: true, service: 'robin-api' }))

  app.use('/',         authRouter)
  app.use('/whatsapp', whatsappRouter)
  app.use('/',         gmailRouter)
  app.use('/',         chatRouter)

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Error]', message)
    res.status(500).json({ error: message })
  })

  return app
}
