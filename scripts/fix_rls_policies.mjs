/**
 * Patches all live RLS policies that check app.tenant_id → app.current_tenant.
 * Runs as neondb_owner (DDL privileges required).
 *
 * Tables affected (currently broken):
 *   workers, conversations, messages, approvals, audit_log,
 *   prompt_history, business_memory_legacy
 */
import pg from 'pg'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
const client = await pool.connect()

const fixes = [
  {
    table: 'workers',
    policy: 'workers_tenant_isolation',
  },
  {
    table: 'conversations',
    policy: 'conversations_tenant_isolation',
  },
  {
    table: 'messages',
    policy: 'messages_tenant_isolation',
  },
  {
    table: 'approvals',
    policy: 'approvals_tenant_isolation',
  },
  {
    table: 'audit_log',
    policy: 'audit_log_tenant_isolation',
  },
  {
    table: 'prompt_history',
    policy: 'prompt_history_tenant_isolation',
  },
  {
    table: 'business_memory_legacy',
    policy: 'business_memory_tenant_isolation',
  },
]

console.log('Fixing RLS policies: app.tenant_id → app.current_tenant\n')

for (const { table, policy } of fixes) {
  try {
    await client.query(`DROP POLICY IF EXISTS ${policy} ON ${table}`)
    // NULLIF converts "" → NULL before the uuid cast, so bare connections fail-closed
    // rather than throwing "invalid input syntax for type uuid: """
    await client.query(`
      CREATE POLICY ${policy} ON ${table}
        USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
    `)
    console.log(`  ✓  ${table}.${policy}`)
  } catch (e) {
    console.error(`  ✗  ${table}: ${e.message.split('\n')[0]}`)
  }
}

// Verify all policies now use app.current_tenant
console.log('\nVerifying final state...')
const result = await client.query(`
  SELECT tablename, policyname, qual
  FROM pg_policies
  WHERE schemaname = 'public'
  ORDER BY tablename
`)

let wrongCount = 0
for (const r of result.rows) {
  const usesWrong = r.qual?.includes('app.tenant_id')
  if (usesWrong) {
    console.error(`  ✗  ${r.tablename}.${r.policyname}: still uses app.tenant_id`)
    wrongCount++
  } else {
    console.log(`  ✓  ${r.tablename}.${r.policyname}: app.current_tenant`)
  }
}

if (wrongCount === 0) {
  console.log('\nAll policies now use app.current_tenant.')
} else {
  console.error(`\n${wrongCount} policies still incorrect.`)
  process.exit(1)
}

client.release()
await pool.end()
