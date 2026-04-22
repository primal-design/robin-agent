import express from 'express'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))
import twilio from 'twilio'
import whatsappRouter from './routes/whatsapp.js'
import chatRouter     from './routes/chat.js'
import { chatService } from './services/chat.service.js'
import { findOrCreateUser } from './db/client.js'

export function createApp() {
  const app = express()

  app.use(express.json({ limit: '2mb' }))
  app.use(express.urlencoded({ extended: false }))
  app.use((_, res, next) => { res.removeHeader('Content-Security-Policy'); next() })

  app.use('/frontend', express.static(resolve(__dirname, '../../../frontend')))

  app.get('/health', (_, res) => res.json({ ok: true, service: 'robin-api' }))

  app.use('/whatsapp', whatsappRouter)
  app.use('/',         chatRouter)

  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = err instanceof Error ? err.message : 'Internal server error'
    console.error('[Error]', message)
    res.status(500).json({ error: message })
  })

  return app
}
