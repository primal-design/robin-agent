import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { env } from '../config/env.js'

const ALGO = 'aes-256-gcm'

// Payload format: {keyId}:{ivHex}:{tagHex}:{encHex}
// Legacy format (no keyId):  {ivHex}:{tagHex}:{encHex}  (3 parts — still decryptable)

function keyBuffer(): Buffer {
  const k = env.connectorEncryptionKey
  if (k && k.length === 64) return Buffer.from(k, 'hex')         // 64-char hex → 32 bytes
  if (k && k.length >= 32)  return Buffer.from(k.slice(0, 32), 'utf8') // 32+ char string
  return Buffer.alloc(32, 'dev-connector-encrypt-key-change')    // dev fallback
}

export function validateEncryptionKey(): void {
  const k   = env.connectorEncryptionKey
  const ok  = k && (k.length === 64 || k.length >= 32)
  const dev = env.nodeEnv !== 'production'

  if (!ok && !dev) {
    // In production with connectors in use: hard fail
    if (env.gmailClientId) {
      console.error('❌ FATAL: CONNECTOR_ENCRYPTION_KEY is required in production.')
      console.error('   Generate one with: openssl rand -hex 32')
      process.exit(1)
    }
    console.error('⚠️  CONNECTOR_ENCRYPTION_KEY is not set — Gmail/Drive tokens will not be stored securely.')
  }
}

export function encryptToken(plaintext: string): string {
  if (!plaintext) return ''
  const keyId  = env.connectorEncryptionKeyId || '1'
  const iv     = randomBytes(12)
  const cipher = createCipheriv(ALGO, keyBuffer(), iv)
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  // Include keyId so we can identify which key version encrypted each token
  return `${keyId}:${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`
}

export function decryptToken(ciphertext: string | null | undefined): string {
  if (!ciphertext) return ''
  try {
    const parts = ciphertext.split(':')
    let ivHex: string, tagHex: string, encHex: string

    if (parts.length === 4) {
      // Current format: {keyId}:{iv}:{tag}:{enc}
      [, ivHex, tagHex, encHex] = parts
    } else if (parts.length === 3) {
      // Legacy format (no keyId): {iv}:{tag}:{enc}
      [ivHex, tagHex, encHex] = parts
    } else {
      return ''
    }

    const decipher = createDecipheriv(ALGO, keyBuffer(), Buffer.from(ivHex, 'hex'))
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
    return Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return ''
  }
}

// Extract the keyId from an encrypted token without decrypting.
// Used for rotation: find all grants where encryption_key_id != current key.
export function keyIdFromToken(ciphertext: string): string {
  if (!ciphertext) return ''
  const parts = ciphertext.split(':')
  return parts.length === 4 ? parts[0] : 'legacy'
}
