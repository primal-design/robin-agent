import rateLimit from 'express-rate-limit'

// Public routes — per IP (auth, waitlist, health)
export const publicRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Too many requests, please try again later.' },
})

// Auth routes — stricter to slow brute force
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Too many auth attempts, please try again in 15 minutes.' },
})

// Dashboard API routes — per IP, generous but bounded
export const dashboardRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Dashboard rate limit reached.' },
})

// Chat/Telegram ingress — per IP, prevents flooding
export const chatRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too_many_requests', message: 'Message rate limit reached.' },
})
