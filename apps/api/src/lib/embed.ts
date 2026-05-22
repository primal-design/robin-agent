import { env } from '../config/env.js'

const VOYAGE_URL    = 'https://api.voyageai.com/v1/embeddings'
const VOYAGE_MODEL  = 'voyage-large-2'
const VOYAGE_DIMS   = 1024
const MAX_BATCH     = 20    // Voyage supports up to 128; keep small for safety
const MAX_CHARS     = 2000  // Truncate input to stay within token limits

// Returns null if voyageKey is not configured
export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  if (!env.voyageKey) return null
  if (!texts.length)  return []

  const inputs = texts.map(t => t.slice(0, MAX_CHARS).replace(/\s+/g, ' ').trim())

  const r = await fetch(VOYAGE_URL, {
    method:  'POST',
    headers: {
      Authorization: `Bearer ${env.voyageKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: VOYAGE_MODEL, input: inputs }),
  })

  if (!r.ok) {
    const text = await r.text()
    throw new Error(`Voyage API ${r.status}: ${text.slice(0, 200)}`)
  }

  const data = await r.json() as { data: { embedding: number[] }[]; model: string }
  return data.data.map(d => d.embedding)
}

export { VOYAGE_MODEL, VOYAGE_DIMS, MAX_BATCH }
