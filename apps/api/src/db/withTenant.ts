import { pool } from './pool.js'
import type { PoolClient } from 'pg'

export async function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL app.current_tenant = $1', [tenantId])
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
