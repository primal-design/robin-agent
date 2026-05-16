import { Router } from 'express'
import { createStarterCheckoutSession, handleStripeWebhook } from '../services/stripe.js'
import { pool } from '../db/pool.js'

export const billingRouter = Router()

// Start Stripe checkout for Starter plan (£19/mo)
billingRouter.post('/billing/checkout', async (req, res) => {
  const { tenantId } = req.body
  if (!tenantId) return res.status(400).json({ error: 'tenantId required' })

  const session = await createStarterCheckoutSession(tenantId)
  res.json({ url: session.url })
})

// Stripe webhook — update subscription status in DB
billingRouter.post(
  '/billing/webhook',
  // Raw body needed for Stripe signature verification
  (req, res, next) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => {
      ;(req as any).rawBody = Buffer.from(data)
      next()
    })
  },
  async (req: any, res) => {
    const sig = req.headers['stripe-signature'] as string

    let event
    try {
      event = await handleStripeWebhook(req.rawBody, sig)
    } catch (err: any) {
      return res.status(400).send(`Webhook error: ${err.message}`)
    }

    if (
      event.type === 'checkout.session.completed' ||
      event.type === 'customer.subscription.updated' ||
      event.type === 'customer.subscription.deleted'
    ) {
      const obj = event.data.object as any
      const tenantId =
        obj.metadata?.tenant_id ??
        obj.subscription?.metadata?.tenant_id

      if (tenantId) {
        await pool.query(
          `INSERT INTO subscriptions (tenant_id, stripe_customer_id, stripe_subscription_id, plan, status)
           VALUES ($1, $2, $3, 'starter', $4)
           ON CONFLICT (tenant_id) DO UPDATE
           SET stripe_customer_id     = EXCLUDED.stripe_customer_id,
               stripe_subscription_id = EXCLUDED.stripe_subscription_id,
               status                 = EXCLUDED.status`,
          [
            tenantId,
            obj.customer,
            obj.subscription ?? obj.id,
            event.type === 'customer.subscription.deleted' ? 'canceled' : 'active',
          ]
        )
      }
    }

    res.json({ received: true })
  }
)

billingRouter.get('/billing/success', (_, res) => {
  res.json({ status: 'subscription active' })
})

billingRouter.get('/billing/cancel', (_, res) => {
  res.json({ status: 'checkout cancelled' })
})
