/**
 * RLS isolation verification — runs as fen_app (rolbypassrls=false).
 *
 * Steps:
 *   1. Seed two test tenants as neondb_owner (DDL role)
 *   2. Cross-tenant read test: tenant A cannot see tenant B's rows
 *   3. Own-data test: tenant A can see its own rows
 *   4. Connection-reuse test: after A's transaction commits, same connection
 *      used for B sees only B's data (proves SET LOCAL scoping works)
 *   5. Fail-closed test: no GUC set → 0 rows visible
 *   6. Cleanup via neondb_owner
 *
 * Run: node scripts/verify_rls.mjs
 * Requires env vars: DATABASE_URL (neondb_owner), APP_DATABASE_URL (fen_app)
 */
import pg from 'pg'

const OWNER_URL = process.env.DATABASE_URL
const APP_URL   = process.env.APP_DATABASE_URL

if (!OWNER_URL) { console.error('DATABASE_URL not set'); process.exit(1) }
if (!APP_URL)   { console.error('APP_DATABASE_URL not set'); process.exit(1) }

function makePool(url, max = 5) {
  return new pg.Pool({ connectionString: url, ssl: { rejectUnauthorized: false }, max })
}

let passed = 0
let failed = 0

function ok(label)          { console.log(`  ✓  ${label}`); passed++ }
function fail(label, detail) { console.error(`  ✗  ${label}${detail ? `\n       ${detail}` : ''}`); failed++ }

async function withTenant(client, tenantId, fn) {
  await client.query('BEGIN')
  await client.query(`SET LOCAL app.current_tenant = '${tenantId}'`)
  try {
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  }
}

// ── Seed (as owner — bypasses RLS intentionally for setup) ───────────────────

async function seed(ownerPool) {
  console.log('\n[1] Seeding test data as neondb_owner...')
  const client = await ownerPool.connect()
  try {
    const tenantRes = await client.query(`
      INSERT INTO tenants (name, type, plan) VALUES
        ('__rls_test_tenant_A', 'client', 'starter'),
        ('__rls_test_tenant_B', 'client', 'starter')
      RETURNING id, name
    `)
    const tenantA = tenantRes.rows.find(r => r.name === '__rls_test_tenant_A').id
    const tenantB = tenantRes.rows.find(r => r.name === '__rls_test_tenant_B').id

    const workerA = (await client.query(
      `INSERT INTO workers (tenant_id, name, manifest, status) VALUES ($1, 'Worker A', '{}', 'live') RETURNING id`,
      [tenantA]
    )).rows[0].id
    const workerB = (await client.query(
      `INSERT INTO workers (tenant_id, name, manifest, status) VALUES ($1, 'Worker B', '{}', 'live') RETURNING id`,
      [tenantB]
    )).rows[0].id

    const convA = (await client.query(
      `INSERT INTO conversations (tenant_id, worker_id, external_user_id, channel) VALUES ($1, $2, 'u_a', 'telegram') RETURNING id`,
      [tenantA, workerA]
    )).rows[0].id
    const convB = (await client.query(
      `INSERT INTO conversations (tenant_id, worker_id, external_user_id, channel) VALUES ($1, $2, 'u_b', 'telegram') RETURNING id`,
      [tenantB, workerB]
    )).rows[0].id

    await client.query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, content) VALUES ($1, $2, 'inbound', 'secret A')`,
      [tenantA, convA]
    )
    await client.query(
      `INSERT INTO messages (tenant_id, conversation_id, direction, content) VALUES ($1, $2, 'inbound', 'secret B')`,
      [tenantB, convB]
    )

    await client.query(
      `INSERT INTO business_memory_core (tenant_id, memory_key, memory_value) VALUES ($1, 'rls_test', '"secret_A"')`,
      [tenantA]
    )
    await client.query(
      `INSERT INTO business_memory_core (tenant_id, memory_key, memory_value) VALUES ($1, 'rls_test', '"secret_B"')`,
      [tenantB]
    )

    await client.query(`INSERT INTO approvals (tenant_id, worker_id, action_type, action_payload) VALUES ($1,$2,'t','{}')`, [tenantA, workerA])
    await client.query(`INSERT INTO approvals (tenant_id, worker_id, action_type, action_payload) VALUES ($1,$2,'t','{}')`, [tenantB, workerB])

    await client.query(`INSERT INTO audit_log (tenant_id, actor, action) VALUES ($1,'test','rls_test_A')`, [tenantA])
    await client.query(`INSERT INTO audit_log (tenant_id, actor, action) VALUES ($1,'test','rls_test_B')`, [tenantB])

    console.log(`    Tenant A: ${tenantA}`)
    console.log(`    Tenant B: ${tenantB}`)
    return { tenantA, tenantB }
  } finally {
    client.release()
  }
}

// ── Cross-tenant tests ────────────────────────────────────────────────────────

async function testCrossTenant(appPool, tenantA, tenantB) {
  console.log('\n[2] Cross-tenant isolation (as fen_app, rolbypassrls=false)...')

  const tables = ['workers', 'conversations', 'messages', 'business_memory_core', 'approvals', 'audit_log']

  for (const table of tables) {
    const client = await appPool.connect()
    try {
      const leakCount = await withTenant(client, tenantA, async (c) => {
        const r = await c.query(`SELECT COUNT(*) FROM ${table} WHERE tenant_id = $1`, [tenantB])
        return Number(r.rows[0].count)
      })

      const ownCount = await withTenant(client, tenantA, async (c) => {
        const r = await c.query(`SELECT COUNT(*) FROM ${table} WHERE tenant_id = $1`, [tenantA])
        return Number(r.rows[0].count)
      })

      if (leakCount === 0) {
        ok(`${table}: A cannot read B's rows`)
      } else {
        fail(`${table}: A READ ${leakCount} of B's rows — ISOLATION BREACH`)
      }

      if (ownCount > 0) {
        ok(`${table}: A can read its own rows (${ownCount})`)
      } else {
        fail(`${table}: A cannot read its own rows — policy too restrictive`)
      }
    } finally {
      client.release()
    }
  }
}

// ── Connection-reuse test ─────────────────────────────────────────────────────

async function testConnectionReuse(appPool, tenantA, tenantB) {
  console.log('\n[3] Connection-reuse test (SET LOCAL clears on COMMIT)...')

  // Pool of exactly 1 connection forces reuse
  const singlePool = makePool(APP_URL, 1)

  try {
    // Transaction 1: tenant A
    const resultA = await (async () => {
      const client = await singlePool.connect()
      try {
        return await withTenant(client, tenantA, async (c) => {
          const pidRes = await c.query('SELECT pg_backend_pid() AS pid')
          const wRes   = await c.query(`SELECT COUNT(*) FROM workers WHERE tenant_id = $1`, [tenantA])
          return { pid: Number(pidRes.rows[0].pid), ownWorkers: Number(wRes.rows[0].count) }
        })
      } finally {
        client.release() // connection returns to pool — SET LOCAL cleared by COMMIT
      }
    })()

    // Transaction 2: tenant B (on the same pooled connection)
    const resultB = await (async () => {
      const client = await singlePool.connect()
      try {
        return await withTenant(client, tenantB, async (c) => {
          const pidRes  = await c.query('SELECT pg_backend_pid() AS pid')
          // The critical check: does B see A's workers?
          const leakRes = await c.query(`SELECT COUNT(*) FROM workers WHERE tenant_id = $1`, [tenantA])
          const ownRes  = await c.query(`SELECT COUNT(*) FROM workers WHERE tenant_id = $1`, [tenantB])
          return {
            pid: Number(pidRes.rows[0].pid),
            tenantA_visible: Number(leakRes.rows[0].count),
            ownWorkers: Number(ownRes.rows[0].count),
          }
        })
      } finally {
        client.release()
      }
    })()

    const sameConn = resultA.pid === resultB.pid
    if (sameConn) {
      ok(`Same physical connection reused (PID ${resultA.pid})`)
    } else {
      console.log(`    (PIDs differ: ${resultA.pid} → ${resultB.pid} — pool used different connection; result still valid)`)
    }

    if (resultB.tenantA_visible === 0) {
      ok(`After reuse: B cannot see A's workers — SET LOCAL scoping confirmed`)
    } else {
      fail(`After reuse: B saw ${resultB.tenantA_visible} of A's workers — STALE CONTEXT`)
    }

    if (resultB.ownWorkers > 0) {
      ok(`After reuse: B can see its own workers (${resultB.ownWorkers})`)
    } else {
      fail(`After reuse: B cannot see its own workers`)
    }

    if (resultA.ownWorkers > 0) {
      ok(`A's transaction saw its own workers (${resultA.ownWorkers})`)
    } else {
      fail(`A's transaction could not see its own workers`)
    }

  } finally {
    await singlePool.end()
  }
}

// ── Fail-closed test ──────────────────────────────────────────────────────────

async function testFailClosed(appPool, tenantA) {
  console.log('\n[4] Fail-closed: no GUC set → 0 rows visible...')

  const tables = ['workers', 'conversations', 'messages', 'business_memory_core', 'approvals', 'audit_log']

  for (const table of tables) {
    const client = await appPool.connect()
    try {
      // Deliberately NOT calling withTenant
      const r = await client.query(`SELECT COUNT(*) FROM ${table} WHERE tenant_id = $1`, [tenantA])
      const count = Number(r.rows[0].count)

      if (count === 0) {
        ok(`${table}: bare connection sees 0 rows (fail-closed)`)
      } else {
        fail(`${table}: bare connection saw ${count} rows — RLS not engaging`)
      }
    } finally {
      client.release()
    }
  }
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

async function cleanup(ownerPool, tenantA, tenantB) {
  console.log('\n[5] Cleanup...')
  const client = await ownerPool.connect()
  try {
    await client.query(`DELETE FROM tenants WHERE name IN ('__rls_test_tenant_A', '__rls_test_tenant_B')`)
    console.log('    Done.')
  } finally {
    client.release()
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

const ownerPool = makePool(OWNER_URL, 3)
const appPool   = makePool(APP_URL, 3)

let tenantA, tenantB

console.log('=== FEN RLS isolation verification ===')
console.log(`Owner URL: ${OWNER_URL.replace(/:([^:@]+)@/, ':***@')}`)
console.log(`App URL:   ${APP_URL.replace(/:([^:@]+)@/, ':***@')}`)

try {
  ;({ tenantA, tenantB } = await seed(ownerPool))
  await testCrossTenant(appPool, tenantA, tenantB)
  await testConnectionReuse(appPool, tenantA, tenantB)
  await testFailClosed(appPool, tenantA)
} finally {
  if (tenantA && tenantB) {
    await cleanup(ownerPool, tenantA, tenantB).catch(e => console.error('Cleanup error:', e.message))
  }
  await ownerPool.end()
  await appPool.end()
}

console.log(`\n${'─'.repeat(44)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)

if (failed > 0) {
  console.error('\nFAILED — isolation is not guaranteed.')
  process.exit(1)
} else {
  console.log('\nPASSED — isolation verified on live Neon.')
}
