import Stripe from 'stripe'

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set')
  return new Stripe(key)
}

export async function createStarterCheckoutSession(tenantId: string) {
  return getStripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [
      {
        price: process.env.STRIPE_STARTER_PRICE_ID!,
        quantity: 1,
      },
    ],
    success_url: `${process.env.APP_URL}/billing/success?tenant=${tenantId}`,
    cancel_url:  `${process.env.APP_URL}/billing/cancel`,
    metadata:    { tenant_id: tenantId },
  })
}

export async function handleStripeWebhook(rawBody: Buffer, sig: string) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set')

  const event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret)
  return event
}
