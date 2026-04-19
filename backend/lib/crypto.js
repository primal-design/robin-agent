/**
 * Robin crypto utils — token generation and OTP
 */

import { randomBytes, createHmac } from 'crypto'

export function generateToken(length = 32) {
  return randomBytes(length).toString('hex')
}

export function generateOTP(digits = 6) {
  const max = Math.pow(10, digits)
  const min = Math.pow(10, digits - 1)
  return String(Math.floor(min + Math.random() * (max - min)))
}

export function signPayload(payload, secret) {
  const str = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return createHmac('sha256', secret || process.env.ANTHROPIC_KEY || 'robin-secret').update(str).digest('hex')
}

export function generateSessionId() {
  return 'sid_' + randomBytes(12).toString('hex')
}
