import type { PoolClient } from 'pg'
import crypto from 'crypto'

export interface CoreMemory {
  [key: string]: unknown
}

export interface SearchResult {
  id:         string
  title:      string
  content:    string
  source_type: string
  similarity?: number
}

export interface HydratedContext {
  tenantId:        string
  conversationId?: string
  jobRunId?:       string
  coreMemory:      CoreMemory
  searchContext:   SearchResult[]
  snapshotId:      string
  tokenEstimate:   number
}

export interface HydratorInput {
  client:          PoolClient
  tenantId:        string
  conversationId?: string
  jobRunId?:       string
  taskPrompt?:     string
  searchQuery?:    string
  includeSearch?:  boolean
}

export async function hydrateMemory(input: HydratorInput): Promise<HydratedContext> {
  const { client, tenantId, conversationId, jobRunId, searchQuery, includeSearch = false } = input

  // 1. Load bounded core memory (approved, active rows only)
  const coreRes = await client.query(
    `SELECT memory_key, memory_value
     FROM business_memory_core
     WHERE tenant_id = $1
       AND status = 'active'
       AND security_status = 'approved'
     ORDER BY memory_key`,
    [tenantId]
  )

  const coreMemory: CoreMemory = {}
  for (const row of coreRes.rows as { memory_key: string; memory_value: unknown }[]) {
    const val = row.memory_value
    // Unwrap scalar JSONB strings back to plain strings for prompt injection
    coreMemory[row.memory_key] = (typeof val === 'object' && val !== null && !Array.isArray(val))
      ? val
      : String(val ?? '')
  }

  // 2. Optionally retrieve semantic search context
  let searchContext: SearchResult[] = []
  if (includeSearch && searchQuery) {
    // Plain text search fallback (no embedding yet — embedding pipeline comes in Phase 2)
    const searchRes = await client.query(
      `SELECT id, title, content, source_type
       FROM business_memory_search
       WHERE tenant_id = $1
         AND (content ILIKE $2 OR title ILIKE $2)
       ORDER BY updated_at DESC
       LIMIT 5`,
      [tenantId, `%${searchQuery.slice(0, 100)}%`]
    )
    searchContext = searchRes.rows as SearchResult[]
  }

  // 3. Estimate token count (rough: 1 token ≈ 4 chars)
  const block = { coreMemory, searchContext }
  const blockJson = JSON.stringify(block)
  const tokenEstimate = Math.ceil(blockJson.length / 4)

  // 4. Freeze snapshot
  const memoryVersionHash = crypto
    .createHash('sha256')
    .update(blockJson)
    .digest('hex')
    .slice(0, 16)

  const snapRes = await client.query(
    `INSERT INTO business_memory_snapshots
       (tenant_id, job_run_id, conversation_id, memory_block, memory_version_hash, token_estimate)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      tenantId,
      jobRunId  ?? null,
      conversationId ?? null,
      JSON.stringify(block),
      memoryVersionHash,
      tokenEstimate,
    ]
  )

  return {
    tenantId,
    conversationId,
    jobRunId,
    coreMemory,
    searchContext,
    snapshotId:    snapRes.rows[0].id as string,
    tokenEstimate,
  }
}

// Render core memory as flat key→value string map for prompt template injection
export function flattenCoreMemory(coreMemory: CoreMemory): Record<string, string> {
  const flat: Record<string, string> = {}
  for (const [key, val] of Object.entries(coreMemory)) {
    flat[key] = typeof val === 'string' ? val : JSON.stringify(val)
  }
  return flat
}
