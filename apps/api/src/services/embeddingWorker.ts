import { pool }                          from '../db/pool.js'
import { embedTexts, VOYAGE_MODEL,
         VOYAGE_DIMS, MAX_BATCH }        from '../lib/embed.js'
import { env }                           from '../config/env.js'

const POLL_INTERVAL_MS = 5 * 60 * 1000   // run every 5 minutes

async function processEmbeddingBatch(): Promise<number> {
  if (!env.voyageKey) return 0

  // Claim a batch with FOR UPDATE SKIP LOCKED to avoid race conditions
  const rows = await pool.query<{
    id: string; title: string; content: string
  }>(
    `SELECT id, title, content
     FROM business_memory_search
     WHERE embedding IS NULL
       AND embedding_queued_at IS NOT NULL
     ORDER BY embedding_queued_at ASC
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [MAX_BATCH]
  )

  if (!rows.rows.length) return 0

  // Build input: title + first N chars of content
  const texts = rows.rows.map(r =>
    `${r.title}\n\n${r.content}`.slice(0, 2000).trim()
  )

  let embeddings: number[][] | null
  try {
    embeddings = await embedTexts(texts)
  } catch (err) {
    console.error('[embeddingWorker] Voyage API error:', err)
    return 0
  }

  if (!embeddings) return 0

  // Persist each embedding
  let stored = 0
  for (let i = 0; i < rows.rows.length; i++) {
    const vec = embeddings[i]
    if (!vec || vec.length !== VOYAGE_DIMS) continue

    // pgvector expects a string like '[0.1,0.2,...]'
    const vectorStr = '[' + vec.join(',') + ']'

    await pool.query(
      `UPDATE business_memory_search
       SET embedding            = $1::vector,
           embedding_model      = $2,
           embedding_updated_at = now(),
           embedding_queued_at  = NULL
       WHERE id = $3`,
      [vectorStr, VOYAGE_MODEL, rows.rows[i].id]
    )
    stored++
  }

  return stored
}

export async function runEmbeddingWorker(): Promise<void> {
  if (!env.voyageKey) return

  try {
    // Process until the queue is drained or we've done 5 batches per run
    let totalStored = 0
    for (let pass = 0; pass < 5; pass++) {
      const n = await processEmbeddingBatch()
      totalStored += n
      if (n < MAX_BATCH) break  // queue is drained
    }
    if (totalStored > 0) {
      console.log(`[embeddingWorker] stored ${totalStored} embeddings`)
    }
  } catch (err) {
    console.error('[embeddingWorker] error:', err)
  }
}

export function startEmbeddingWorker(): void {
  if (!env.voyageKey) {
    console.log('[embeddingWorker] VOYAGE_API_KEY not set — embedding worker disabled')
    return
  }

  // Initial run after 30 seconds (let connectors warm up first)
  setTimeout(() => {
    runEmbeddingWorker()
    setInterval(runEmbeddingWorker, POLL_INTERVAL_MS)
  }, 30_000)

  console.log('[embeddingWorker] started (polling every 5 min)')
}
