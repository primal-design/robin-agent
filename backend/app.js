/**
 * Robin app — Express setup, middleware, routes
 */

import 'dotenv/config'
import express from 'express'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

import { assertRequired } from './config/env.js'
import { globalLimit } from './middleware/rateLimit.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'

import authRouter    from './routes/auth.js'
import chatRouter    from './routes/chat.js'
import emailRouter   from './routes/email.js'
import leadsRouter   from './routes/leads.js'
import actionsRouter from './routes/actions.js'
import privacyRouter   from './routes/privacy.js'
import whatsappRouter  from './routes/whatsapp.js'

assertRequired()

const __dir = dirname(fileURLToPath(import.meta.url))
const app   = express()

// ── Middleware ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '2mb' }))
app.use((req, res, next) => { res.removeHeader('Content-Security-Policy'); next() })
app.use(globalLimit)

// ── Static files ──────────────────────────────────────────────────────────
app.use(express.static(new URL('..', import.meta.url).pathname))
app.use('/frontend', express.static(new URL('../frontend', import.meta.url).pathname))
app.get('/', (_, res) => res.sendFile(new URL('../frontend/robin_site.html', import.meta.url).pathname))

// ── API Routes ────────────────────────────────────────────────────────────
app.use('/',        authRouter)
app.use('/',        chatRouter)
app.use('/email',   emailRouter)
app.use('/actions', actionsRouter)
app.use('/',        leadsRouter)
app.use('/',        privacyRouter)
app.use('/whatsapp', whatsappRouter)

// ── Error handling ────────────────────────────────────────────────────────
app.use(notFound)
app.use(errorHandler)

export default app
