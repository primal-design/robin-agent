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

// ── HackerNews search (no key required) ──────────────────────────────────────
export async function hackerNewsSearch(query: string): Promise<string | null> {
  try {
    const res  = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10`, {
      signal: AbortSignal.timeout(6000)
    })
    if (!res.ok) return null
    const data = await res.json() as { hits: { title: string; points: number; num_comments: number; url: string; objectID: string }[] }
    if (!data.hits?.length) return null
    return data.hits.slice(0, 8).map(h =>
      `• ${h.title} (↑${h.points} | ${h.num_comments} comments)\n  ${h.url || `https://news.ycombinator.com/item?id=${h.objectID}`}`
    ).join('\n')
  } catch { return null }
}

// ── Trend analysis: Reddit + Brave combined ───────────────────────────────────
export async function doTrendAnalysis(topic: string, context = ''): Promise<string> {
  let raw = `Topic: ${topic}\n\n`

  // Reddit: what real people are discussing
  const redditResults = await redditSearch(topic)
  if (redditResults) raw += `REDDIT (real conversations):\n${redditResults}\n\n`

  // HackerNews: tech/startup signal
  const hnResults = await hackerNewsSearch(topic)
  if (hnResults) raw += `HACKERNEWS (tech/startup signal):\n${hnResults}\n\n`

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

  // NewsAPI: latest news coverage
  const newsResults = await newsSearch(topic)
  if (newsResults) raw += `NEWS (latest coverage):\n${newsResults}\n\n`

  // GDELT: global event coverage
  const gdeltResults = await gdeltSearch(topic)
  if (gdeltResults) raw += `GDELT (global news events):\n${gdeltResults}\n\n`

  if (!raw.includes('REDDIT') && !raw.includes('WEB') && !raw.includes('NEWS')) {
    raw += '(No external data — using Claude knowledge only)\n\n'
  }

  const s = await ai().messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 800,
    messages: [{ role: 'user', content: `Analyse real search and social behaviour around: "${topic}".\n${context ? `Context: ${context}\n` : ''}Data:\n${raw}\nIdentify:\n1. What are people struggling with?\n2. What questions keep coming up?\n3. What do they actually want (not what they say they want)?\n4. Any gaps or unmet needs?\n5. Actionable opportunity in one sentence.\n\nBe direct. Use bullet points. Max 6 insights.` }]
  })
  return s.content[0].type === 'text' ? s.content[0].text : ''
}

// ── YouTube Data API ──────────────────────────────────────────────────────────
export async function youtubeSearch(query: string, maxResults = 8): Promise<string | null> {
  if (!env.youtubeKey) return null
  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&maxResults=${maxResults}&order=viewCount&type=video&key=${env.youtubeKey}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const data = await res.json() as { items: { snippet: { title: string; description: string; channelTitle: string } }[] }
    if (!data.items?.length) return null
    return data.items.map(i =>
      `• ${i.snippet.title} — ${i.snippet.channelTitle}\n  ${i.snippet.description?.slice(0, 100) || ''}`
    ).join('\n')
  } catch { return null }
}

// ── Apollo.io lead search ─────────────────────────────────────────────────────
export async function apolloSearch(name: string, domain?: string): Promise<string | null> {
  if (!env.apolloKey) return null
  try {
    const body: Record<string, unknown> = { api_key: env.apolloKey, q_person_name: name, page: 1, per_page: 5 }
    if (domain) body.q_organization_domains = [domain]
    const res  = await fetch('https://api.apollo.io/v1/people/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const data = await res.json() as { people: { name: string; title: string; organization?: { name: string }; email?: string; linkedin_url?: string }[] }
    if (!data.people?.length) return null
    return data.people.map(p =>
      `• ${p.name} — ${p.title} at ${p.organization?.name || 'Unknown'}\n  Email: ${p.email || 'not available'} | LinkedIn: ${p.linkedin_url || 'n/a'}`
    ).join('\n')
  } catch { return null }
}

// ── Hunter.io email finder ────────────────────────────────────────────────────
export async function hunterEmailFind(domain: string, firstName?: string, lastName?: string): Promise<string | null> {
  if (!env.hunterKey) return null
  try {
    let url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${env.hunterKey}&limit=5`
    if (firstName && lastName) url = `https://api.hunter.io/v2/email-finder?domain=${encodeURIComponent(domain)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}&api_key=${env.hunterKey}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const data = await res.json() as { data: { email?: string; emails?: { value: string; type: string; confidence: number }[]; organization?: string } }
    if (data.data.email) return `• ${data.data.email} (${data.data.organization || domain})`
    const emails = data.data.emails || []
    if (!emails.length) return null
    return emails.map(e => `• ${e.value} (${e.type}, ${e.confidence}% confidence)`).join('\n')
  } catch { return null }
}

// ── NewsAPI ───────────────────────────────────────────────────────────────────
export async function newsSearch(query: string, language = 'en'): Promise<string | null> {
  if (!env.newsApiKey) return null
  try {
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=${language}&sortBy=publishedAt&pageSize=8&apiKey=${env.newsApiKey}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const data = await res.json() as { articles: { title: string; description: string; source: { name: string }; publishedAt: string }[] }
    if (!data.articles?.length) return null
    return data.articles.map(a =>
      `• [${a.source.name}] ${a.title}\n  ${a.description?.slice(0, 100) || ''} (${a.publishedAt?.slice(0, 10)})`
    ).join('\n')
  } catch { return null }
}

// ── GDELT (no key required) ───────────────────────────────────────────────────
export async function gdeltSearch(query: string): Promise<string | null> {
  try {
    const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=10&format=json`
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json() as { articles?: { title: string; url: string; domain: string; seendate: string }[] }
    if (!data.articles?.length) return null
    return data.articles.slice(0, 8).map(a =>
      `• [${a.domain}] ${a.title}\n  ${a.url} (${a.seendate?.slice(0, 8)})`
    ).join('\n')
  } catch { return null }
}

// ── Tomorrow.io weather ───────────────────────────────────────────────────────
export async function getWeather(location: string, units = 'metric'): Promise<string | null> {
  if (!env.tomorrowKey) return null
  try {
    const url = `https://api.tomorrow.io/v4/weather/forecast?location=${encodeURIComponent(location)}&timesteps=1d&units=${units}&apikey=${env.tomorrowKey}`
    const res  = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data = await res.json() as {
      timelines?: {
        daily?: {
          time: string
          values: {
            temperatureMax: number
            temperatureMin: number
            precipitationProbabilityAvg: number
            windSpeedAvg: number
            weatherCodeMax: number
            humidityAvg: number
            uvIndexMax: number
          }
        }[]
      }
      location?: { name: string }
    }
    const days = data.timelines?.daily?.slice(0, 5) || []
    if (!days.length) return null

    const weatherCode: Record<number, string> = {
      1000: 'Clear', 1100: 'Mostly Clear', 1101: 'Partly Cloudy', 1102: 'Mostly Cloudy',
      1001: 'Cloudy', 2000: 'Fog', 4000: 'Drizzle', 4001: 'Rain', 4200: 'Light Rain',
      4201: 'Heavy Rain', 5000: 'Snow', 5001: 'Flurries', 6000: 'Freezing Drizzle',
      8000: 'Thunderstorm',
    }

    const tempUnit = units === 'metric' ? '°C' : '°F'
    const name = data.location?.name || location
    const lines = days.map(d => {
      const v = d.values
      const date = new Date(d.time).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
      const condition = weatherCode[v.weatherCodeMax] || 'Unknown'
      return `${date}: ${condition}, ${Math.round(v.temperatureMax)}/${Math.round(v.temperatureMin)}${tempUnit}, rain ${Math.round(v.precipitationProbabilityAvg)}%, wind ${Math.round(v.windSpeedAvg)}km/h, UV ${v.uvIndexMax}`
    })
    return `Weather for ${name}:\n${lines.join('\n')}`
  } catch { return null }
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
