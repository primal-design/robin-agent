/**
 * Input validators
 */

export function isValidPhone(phone) {
  return /^\+?[0-9\s\-().]{7,20}$/.test(phone)
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function requireFields(obj, fields) {
  const missing = fields.filter(f => !obj[f])
  if (missing.length) throw Object.assign(new Error(`Missing required fields: ${missing.join(', ')}`), { status: 400 })
}

export function sanitiseText(str, maxLen = 5000) {
  if (typeof str !== 'string') return ''
  return str.trim().slice(0, maxLen)
}
