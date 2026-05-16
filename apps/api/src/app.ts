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

      // Analytics — consent-gated: PostHog + Cloudflare only load after user accepts
      const analyticsSnippets: string[] = []
      if (env.posthogKey)
        analyticsSnippets.push(`(function(){var s=document.createElement('script');s.type='text/javascript';s.async=true;s.src='https://eu-assets.i.posthog.com/static/array.js';s.onload=function(){window.posthog&&posthog.init('${env.posthogKey}',{api_host:'https://eu.i.posthog.com',persistence:'localStorage'})};document.head.appendChild(s)})()`)
      if (env.cfBeaconToken)
        analyticsSnippets.push(`(function(){var s=document.createElement('script');s.defer=true;s.src='https://static.cloudflareinsights.com/beacon.min.js';s.setAttribute('data-cf-beacon','{"token":"${env.cfBeaconToken}"}');document.head.appendChild(s)})()`)

      if (analyticsSnippets.length && !html.includes('fen-consent')) {
        const consentScript = `
<script id="fen-consent">(function(){
  var KEY='fen_analytics_consent';
  function loadAnalytics(){${analyticsSnippets.join(';')}}
  var consent=localStorage.getItem(KEY);
  if(consent==='true'){loadAnalytics();return;}
  if(consent==='false'){return;}
  // Show banner
  var b=document.createElement('div');
  b.id='fen-cookie-banner';
  b.style.cssText='position:fixed;bottom:0;left:0;right:0;background:#1A1816;color:#F8F7F4;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;z-index:9999;font-family:Inter,sans-serif;font-size:13px;';
  b.innerHTML='<span>We use analytics to improve FEN. No personal data is sold or shared. <a href="/frontend/privacy.html" style="color:#B8976B;text-decoration:none">Privacy policy</a></span>'
    +'<div style="display:flex;gap:10px;flex-shrink:0">'
    +'<button onclick="fenConsent(false)" style="background:transparent;border:1px solid rgba(248,247,244,.3);color:#F8F7F4;padding:7px 16px;cursor:pointer;font-size:12px;font-family:Inter,sans-serif;letter-spacing:.1em">Decline</button>'
    +'<button onclick="fenConsent(true)" style="background:#B8976B;border:none;color:#fff;padding:7px 16px;cursor:pointer;font-size:12px;font-family:Inter,sans-serif;letter-spacing:.1em">Accept</button>'
    +'</div>';
  document.body?document.body.appendChild(b):document.addEventListener('DOMContentLoaded',function(){document.body.appendChild(b)});
  window.fenConsent=function(v){
    localStorage.setItem(KEY,v?'true':'false');
    var el=document.getElementById('fen-cookie-banner');if(el)el.remove();
    if(v)loadAnalytics();
  };
})()</script>`
        headSnippets.push(consentScript)
      }

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
