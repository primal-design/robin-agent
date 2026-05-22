import type { PoolClient } from 'pg'
import crypto               from 'crypto'
import { embedTexts }        from '../lib/embed.js'
import { env }               from '../config/env.js'

export interface CoreMemory {
  [key: string]: unknown
}

export interface SearchResult {
  id:          string
  title:       string
  content:     string
  source_type: string
  source_ref?: string
  metadata?:   Record<string, unknown>
  similarity?: number
}

export interface MemoryPolicy {
  search_enabled?:   boolean
  search_queries?:   string[]  // additional queries beyond the task prompt
  search_max_items?: number    // default 5, max 10
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
  memoryPolicy?:   MemoryPolicy
}

export async function hydrateMemory(input: HydratorInput): Promise<HydratedContext> {
  const {
    client, tenantId, conversationId, jobRunId,
    taskPrompt, searchQuery, includeSearch = false, memoryPolicy,
  } = input

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
    coreMemory[row.memory_key] = (typeof val === 'object' && val !== null && !Array.isArray(val))
      ? val
      : String(val ?? '')
  }

  // 2. Semantic search context
  let searchContext: SearchResult[] = []

  const shouldSearch = includeSearch || memoryPolicy?.search_enabled === true
  const maxItems     = Math.min(memoryPolicy?.search_max_items ?? 5, 10)

  // Build primary query: task prompt or explicit searchQuery
  const primaryQuery = (taskPrompt || searchQuery || '').trim()
  const extraQueries = memoryPolicy?.search_queries ?? []

  if (shouldSearch && primaryQuery) {
    // ── Semantic vector search (Voyage) ──────────────────────────────────────
    if (env.voyageKey) {
      try {
        const embeddings = await embedTexts([primaryQuery])
        if (embeddings && embeddings[0]) {
          const vectorStr = '[' + embeddings[0].join(',') + ']'

          const searchRes = await client.query(
            `SELECT id, title,
                    LEFT(content, 500) AS content,
                    source_type, source_ref, metadata,
                    1 - (embedding <=> $1::vector) AS similarity
             FROM business_memory_search
             WHERE tenant_id = $2
               AND embedding IS NOT NULL
             ORDER BY embedding <=> $1::vector
             LIMIT $3`,
            [vectorStr, tenantId, maxItems]
          )
          searchContext = searchRes.rows as SearchResult[]
        }
      } catch (err) {
        // Embedding call failed — fall through to keyword fallback
        console.warn('[memoryHydrator] embedding search failed, falling back to keyword:', (err as Error).message)
      }
    }

    // ── Keyword fallback (no Voyage key, or embedding call failed) ───────────
    if (!searchContext.length) {
      const kw      = primaryQuery.slice(0, 100)
      const kwExtra = extraQueries.slice(0, 2).map(q => q.slice(0, 100))
      const allKw   = [kw, ...kwExtra]

      // Build OR conditions for multiple queries
      const conditions = allKw.map((_, i) => `(content ILIKE $${i + 3} OR title ILIKE $${i + 3})`).join(' OR ')
      const params      = [tenantId, maxItems, ...allKw.map(q => `%${q}%`)]

      const searchRes = await client.query(
        `SELECT id, title, LEFT(content, 500) AS content,
                source_type, source_ref, metadata
         FROM business_memory_search
         WHERE tenant_id = $1
           AND (${conditions})
         ORDER BY updated_at DESC
         LIMIT $2`,
        params
      )
      searchContext = searchRes.rows as SearchResult[]
    }
  }

  // 3. Estimate token count (rough: 1 token ≈ 4 chars)
  const block      = { coreMemory, searchContext }
  const blockJson  = JSON.stringify(block)
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
    [tenantId, jobRunId ?? null, conversationId ?? null, JSON.stringify(block), memoryVersionHash, tokenEstimate]
  )

  return {
    tenantId, conversationId, jobRunId,
    coreMemory, searchContext,
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

// Render search context as a formatted block for system prompt injection
export function renderSearchContext(results: SearchResult[]): string {
  if (!results.length) return ''
  return results
    .map((r, i) => {
      const score = r.similarity !== undefined ? ` (${Math.round(r.similarity * 100)}% match)` : ''
      const src   = r.source_ref ? ` — ${r.source_ref}` : ''
      return `[${i + 1}] ${r.title}${score}${src}\n${r.content.trim()}`
    })
    .join('\n\n')
}
