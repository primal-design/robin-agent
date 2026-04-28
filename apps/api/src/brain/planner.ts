import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

let _ai: Anthropic | null = null
function ai() { return _ai || (_ai = new Anthropic({ apiKey: env.anthropicKey })) }

const RESEARCH_QUERIES: Record<string, (q: string) => string[]> = {
  person:     q => [`${q} background career`, `${q} social media work`, `${q} projects skills`],
  market:     q => [`${q} market size 2025`, `${q} opportunities gaps`, `${q} top players`],
  topic:      q => [`${q} explained`, `${q} best practices`, `${q} examples`],
  competitor: q => [`${q} pricing features`, `${q} reviews complaints`, `${q} business model`],
  trend:      q => [`${q} trending 2025`, `${q} growth stats`, `${q} who is doing it`],
}

// ── Reddit search (no key required) ──────────────────────────────────────────
export async function redditSearch(query: string, subreddit = ''): Promise<string | null> {
  try {
    const base = subreddit ? `https://www.reddit.com/r/${subreddit}/search.json` : 'https://www.reddit.com/search.json'
    const url  = `${base}?q=${encodeURIComponent(query)}&sort=top&t=month&limit=10&restrict_sr=${subreddit ? 'true' : 'false'}`
    const res  = await fetch(url, { headers: { 'User-Agent': 'Robin/1.0 research-bot' }, signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const data = await res.json() as { data?: { children: { data: { title: string; selftext: string; score: number; num_comments: number; subreddit: string } }[] } }
    const posts = data.data?.children || []
    if (!posts.length) return null
    return posts.slice(0, 8).map(p => {
      const d = p.data
      const preview = d.selftext?.replace(/\s+/g, ' ').slice(0, 120) || ''
      return `• [r/${d.subreddit}] ${d.title} (↑${d.score} | ${d.num_comments} comments)${preview ? `\n  "${preview}..."` : ''}`
    }).join('\n')
  } catch { return null }
}

// ── Trend analysis: Reddit + Brave combined ───────────────────────────────────
export async function doTrendAnalysis(topic: string, context = ''): Promise<string> {
  let raw = `Topic: ${topic}\n\n`

  // Reddit: what real people are discussing
  const redditResults = await redditSearch(topic)
  if (redditResults) raw += `REDDIT (real conversations):\n${redditResults}\n\n`

  // Brave: what's being written/published
  if (env.braveKey) {
    const queries = [`${topic} trends 2025`, `${topic} problems people face`, `${topic} what people want`]
    for (const q of queries) {
      try {
        const res  = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=3`, {
          headers: { 'X-Subscription-Token': env.braveKey, 'Accept': 'application/json' }
        })
        const data = await res.json() as { web?: { results: { title: string; description: string }[] } }
        const results = (data.web?.results || []).map(r => `• ${r.title}: ${r.description}`).join('\n')
        if (results) raw += `WEB: "${q}"\n${results}\n\n`
      } catch { /* skip */ }
    }
  }

  if (!raw.includes('REDDIT') && !raw.includes('WEB')) {
    raw += '(No external data — using Claude knowledge only)\n\n'
  }

  const s = await ai().messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 800,
    messages: [{ role: 'user', content: `Analyse real search and social behaviour around: "${topic}".\n${context ? `Context: ${context}\n` : ''}Data:\n${raw}\nIdentify:\n1. What are people struggling with?\n2. What questions keep coming up?\n3. What do they actually want (not what they say they want)?\n4. Any gaps or unmet needs?\n5. Actionable opportunity in one sentence.\n\nBe direct. Use bullet points. Max 6 insights.` }]
  })
  return s.content[0].type === 'text' ? s.content[0].text : ''
}

async function braveSearch(query: string): Promise<string | null> {
  if (!env.braveKey) return null
  try {
    const res  = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`, {
      headers: { 'X-Subscription-Token': env.braveKey, 'Accept': 'application/json' }
    })
    const data = await res.json() as { web?: { results: { title: string; description: string }[] } }
    return (data.web?.results || []).map(r => `• ${r.title}: ${r.description}`).join('\n')
  } catch { return null }
}

export async function doResearch(type: string, query: string, context = ''): Promise<string> {
  const queries = RESEARCH_QUERIES[type]?.(query) || [query]
  let raw = `Research type: ${type}\nQuery: ${query}\n\n`
  if (env.braveKey) {
    for (const q of queries) {
      const r = await braveSearch(q)
      if (r) raw += `Search: "${q}"\n${r}\n\n`
    }
  } else {
    raw += '(No Brave key — using Claude knowledge only)\n\n'
  }
  const s = await ai().messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 600,
    messages: [{ role: 'user', content: `Research: "${query}" (${type}).\n${context ? `Why: ${context}\n` : ''}Data:\n${raw}\nSharp summary, bullet points, max 5 insights. Focus on what's actionable.` }]
  })
  return s.content[0].type === 'text' ? s.content[0].text : ''
}
