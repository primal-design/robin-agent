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
