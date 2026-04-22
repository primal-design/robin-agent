/**
 * Robin planner — 21-day plan generation and research engine
 */

import Anthropic from '@anthropic-ai/sdk'

let _ai = null
function ai() { return _ai || (_ai = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })) }

const RESEARCH_QUERIES = {
  person:     (q) => [`${q} background career`, `${q} social media work`, `${q} projects skills`],
  market:     (q) => [`${q} market size 2025`, `${q} opportunities gaps`, `${q} top players`],
  topic:      (q) => [`${q} explained`, `${q} best practices`, `${q} examples`],
  competitor: (q) => [`${q} pricing features`, `${q} reviews complaints`, `${q} business model`],
  trend:      (q) => [`${q} trending 2025`, `${q} growth stats`, `${q} who is doing it`]
}

async function braveSearch(query) {
  if (!process.env.BRAVE_KEY) return null
  try {
    const res  = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`, {
      headers: { 'X-Subscription-Token': process.env.BRAVE_KEY, 'Accept': 'application/json' }
    })
    const data = await res.json()
    return (data.web?.results || []).map(r => `• ${r.title}: ${r.description}`).join('\n')
  } catch { return null }
}

export async function doResearch(type, query, context = '') {
  const queries = RESEARCH_QUERIES[type]?.(query) || [query]
  let raw = `Research type: ${type}\nQuery: ${query}\n\n`
  if (process.env.BRAVE_KEY) {
    for (const q of queries) { const r = await braveSearch(q); if (r) raw += `Search: "${q}"\n${r}\n\n` }
  } else { raw += '(No Brave key — using Claude knowledge only)\n\n' }
  const s = await ai().messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 600,
    messages: [{ role: 'user', content: `Research: "${query}" (${type}).\n${context ? `Why: ${context}\n` : ''}Data:\n${raw}\nSharp summary, bullet points, max 5 insights. Focus on what's actionable.` }]
  })
  return s.content[0].text
}

export function generate21DayPlan(goal, niche, timePerDay) {
  return `21-DAY PLAN
Goal: ${goal}
Niche: ${niche}
Time: ${timePerDay} mins/day

WEEK 1: Define offer → find 10 targets → write outreach → send to 5 people
WEEK 2: Follow up → handle replies → book calls
WEEK 3: Run calls → send proposals → close first ${goal}

START TODAY: Write your offer in one sentence.`
}
