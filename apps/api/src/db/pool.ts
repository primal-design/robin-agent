import pg from 'pg'
import { env } from '../config/env.js'

function dbUrl(raw: string) {
  if (!raw) return raw
  try {
    const u = new URL(raw)
    u.searchParams.set('sslmode', 'verify-full')
    return u.toString()
  } catch { return raw }
}

export const pool = new pg.Pool({
  connectionString: dbUrl(env.databaseUrl),
  ssl: env.databaseUrl.includes('neon.tech') ? { rejectUnauthorized: false } : false,
  max: 10,
})
