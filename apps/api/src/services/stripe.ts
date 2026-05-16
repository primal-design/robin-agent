import Stripe from 'stripe'

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '')

export async function createStarterCheckoutSession(tenantId: string) {
  return stripe.checkout.sessions.create({
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

  const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret)
  return event
}
