import { env } from '../../config/env.js'

export interface SearchResult {
  title:   string
  url:     string
  snippet: string
}

export async function webSearch(query: string, count = 5): Promise<SearchResult[]> {
  if (!env.braveKey) throw new Error('BRAVE_KEY not configured')

  const res = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${count}`,
    {
      headers: {
        'X-Subscription-Token': env.braveKey,
        'Accept': 'application/json',
      },
    }
  )

  if (!res.ok) throw new Error(`Brave search failed: ${res.status}`)

  const data = await res.json() as {
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> }
  }

  return (data.web?.results ?? []).map((r) => ({
    title:   r.title   ?? '',
    url:     r.url     ?? '',
    snippet: r.description ?? '',
  }))
}
