import 'dotenv/config'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'

const __dir = dirname(fileURLToPath(import.meta.url))
const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })

// ── Zero-skill hustles ────────────────────────────────────────────────────
const ZERO_SKILL_HUSTLES = [
  { id: 'reviews',  title: 'Get Google reviews for local businesses', timeline: '£50-200 in 7 days',  effort: '2 hours/day',         pitch: 'Message 10 restaurants. Get paid £50-100 each to get them 5 reviews.' },
  { id: 'delivery', title: 'Same-day errand / delivery service',      timeline: '£50-150 in 3 days',  effort: 'As much as you want', pitch: 'Post on Facebook: "I do errands, pickups, deliveries in [your area]. £15/hour."' },
  { id: 'cleaning', title: 'End of tenancy / deep clean',             timeline: '£100-300 in 5 days', effort: '4-6 hours per job',    pitch: 'Post on Gumtree and local Facebook groups. First job gets you a review.' },
  { id: 'resell',   title: 'Buy and resell locally',                  timeline: '£50-200 in 7 days',  effort: '2-3 hours browsing',  pitch: 'Find free or cheap items on Facebook Marketplace. Clean them. Resell for 3x.' }
]
function formatZeroSkillHustles() {
  return ZERO_SKILL_HUSTLES.map(h => `- ${h.title} (${h.timeline}, ${h.effort}): ${h.pitch}`).join('\n')
}

// ── Skills loader ─────────────────────────────────────────────────────────
function loadSkills() {
  const skillsDir = join(__dir, 'skills')
  if (!existsSync(skillsDir)) return []
  return readdirSync(skillsDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const raw = readFileSync(join(skillsDir, f), 'utf8')
      const { data, content } = matter(raw)
      return { ...data, content }
    })
}
function getRelevantSkills(message) {
  const skills = loadSkills()
  const lower = message.toLowerCase()
  return skills
    .filter(s => (s.triggers || []).some(t => lower.includes(t.toLowerCase())))
    .map(s => `## Skill: ${s.name}\n${s.content}`)
    .join('\n\n')
}

const app = express()
const PORT = process.env.PORT || 3000
app.use(express.json({ limit: '2mb' }))
app.use((req, res, next) => { res.removeHeader('Content-Security-Policy'); next() })
app.use(express.static(new URL('.', import.meta.url).pathname))
app.get('/', (_, res) => res.sendFile(new URL('index.html', import.meta.url).pathname))

// ── Storage helpers ───────────────────────────────────────────────────────
function loadStore() {
  return existsSync('memory.json') ? JSON.parse(readFileSync('memory.json', 'utf8')) : {}
}
function saveStore(store) {
  writeFileSync('memory.json', JSON.stringify(store, null, 2))
}
function loadSession(id) {
  const store = loadStore()
  return store[id] || { messages: [], facts: [], rejection_round: 0, streak: 0, tasks_done: 0, total_earned: 0 }
}
function saveSession(id, data) {
  const store = loadStore()
  store[id] = { ...data, savedAt: new Date().toISOString() }
  saveStore(store)
}
function loadProfile(sessionId) {
  const store = loadStore()
  const p = store[`profile_${sessionId}`]
  if (!p) return null
  if (Date.now() - new Date(p.created_at).getTime() > 30 * 24 * 60 * 60 * 1000) {
    delete store[`profile_${sessionId}`]
    saveStore(store)
    return null
  }
  return p
}
function saveProfile(sessionId, sourceType, rawData, summary) {
  const store = loadStore()
  store[`profile_${sessionId}`] = {
    source_type: sourceType,
    raw_data: rawData.slice(0, 5000),
    summary,
    created_at: new Date().toISOString(),
    delete_after: '30_days'
  }
  saveStore(store)
}

// ── Research engine ───────────────────────────────────────────────────────
const RESEARCH_QUERIES = {
  person:     (q) => [`${q} background career`, `${q} work projects`, `${q} social media`],
  market:     (q) => [`${q} market size trends 2025`, `${q} opportunities gaps`, `${q} top players`],
  topic:      (q) => [`${q} explained`, `${q} best practices`, `${q} examples`],
  competitor: (q) => [`${q} pricing features`, `${q} reviews complaints`, `${q} business model`],
  trend:      (q) => [`${q} trending 2025`, `${q} growth stats`, `${q} who is doing it`]
}
async function braveSearch(query) {
  if (!process.env.BRAVE_KEY) return null
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`,
      { headers: { 'X-Subscription-Token': process.env.BRAVE_KEY, 'Accept': 'application/json' } }
    )
    const data = await res.json()
    return (data.web?.results || []).map(r => `• ${r.title}: ${r.description}`).join('\n')
  } catch { return null }
}
async function doResearch(type, query, context = '') {
  const queries = RESEARCH_QUERIES[type]?.(query) || [query]
  let raw = `Research type: ${type}\nQuery: ${query}\n\n`
  if (process.env.BRAVE_KEY) {
    for (const q of queries) {
      const results = await braveSearch(q)
      if (results) raw += `Search: "${q}"\n${results}\n\n`
    }
  } else {
    raw += '(No Brave key — using Claude knowledge only)\n\n'
  }
  const synthesis = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: `You are helping someone research: "${query}" (type: ${type}).\n${context ? `Why they need it: ${context}` : ''}\n\nRaw search data:\n${raw}\n\nGive a sharp, useful summary. Focus on what's most actionable for this person. Use bullet points. Max 5 key insights.` }]
  })
  return synthesis.content[0].text
}

// ── Rejection tree context ────────────────────────────────────────────────
function rejectionContext(round) {
  if (round === 0) return ''
  if (round === 1) return `\nUSER REJECTED FIRST SUGGESTION. Ask one filter question (online or in-person? solo or with people?). Then give 3 different options — different category, never repeat.`
  if (round === 2) return `\nUSER REJECTED TWICE. Ask one final filter question (how much time per day?). Then give 3 final very specific options with exact first steps.`
  return `\nUSER REJECTED THREE TIMES — NUCLEAR OPTION. Do not ask any more questions. Just say: "Tell me one thing you did this week — anything. I'll find the money in it." Then when they answer, commit to a hustle based on whatever they say.`
}

// ── Robin brain ───────────────────────────────────────────────────────────
async function think(sessionId, userMessage) {
  const memory  = loadSession(sessionId)
  const profile = loadProfile(sessionId)

  if (userMessage) memory.messages.push({ role: 'user', content: userMessage })

  const profileContext = profile ? `\nUser profile:\n${profile.summary}` : ''
  const skillContext   = userMessage ? getRelevantSkills(userMessage) : ''
  const skillsSection  = skillContext ? `\n\n# Active Skills\n${skillContext}` : ''
  const rejectCtx      = rejectionContext(memory.rejection_round || 0)

  const msgCount = memory.messages.filter(m => m.role === 'assistant').length
  const model    = msgCount < 3 ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'

  const response = await ai.messages.create({
    model,
    max_tokens: 1000,
    system: `You're Robin — a side hustle mentor. Your one job: get people to their first £100.

RULES:
- Max 2 sentences. Never more.
- No lists, no bullet points, no long explanations.
- Never ask two questions in a row without giving something first.
- If they need money → ask ONE thing: what can they do?
- If they have no skills → pick ONE hustle from the zero-skill list and tell them exactly what to do TODAY.
- If they're frustrated → skip sympathy, give one action RIGHT NOW.
- Once you know their skill/niche → name the hustle, the buyer, the price. Be specific.
- Never say "great question", "I'm here to help", or anything corporate.
- Only build a full 21-day plan when they say "build", "let's go", "make me a plan" or similar.
- End every message with 🦊
${rejectCtx}

ZERO-SKILL HUSTLES:
${formatZeroSkillHustles()}

Current time: ${new Date().toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true })}
Streak: ${memory.streak || 0} days | Tasks done: ${memory.tasks_done || 0} | Total earned: £${memory.total_earned || 0}
What you know: ${memory.facts.join(', ') || 'nothing yet'}${profileContext}${skillsSection}`,
    tools: [
      {
        name: 'remember_fact',
        description: 'Remember a fact about the user',
        input_schema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] }
      },
      {
        name: 'build_plan',
        description: 'Build a 21-day action plan when user explicitly asks',
        input_schema: { type: 'object', properties: { goal: { type: 'string' }, niche: { type: 'string' }, timePerDay: { type: 'number' } }, required: ['goal', 'niche', 'timePerDay'] }
      },
      {
        name: 'research',
        description: 'Research a person, market, topic, competitor, or trend',
        input_schema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['person', 'market', 'topic', 'competitor', 'trend'] },
            query: { type: 'string' },
            context: { type: 'string' }
          },
          required: ['type', 'query']
        }
      },
      {
        name: 'log_task_done',
        description: 'User completed a task. Log it, update streak, check for £100 milestone.',
        input_schema: { type: 'object', properties: { amount_earned: { type: 'number', description: 'Amount earned in £, 0 if not a money task' }, task_description: { type: 'string' } }, required: ['task_description'] }
      }
    ],
    messages: memory.messages.slice(-20)
  })

  if (response.stop_reason === 'tool_use') {
    const results = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue

      if (block.name === 'remember_fact') {
        memory.facts.push(block.input.fact)
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `Saved: ${block.input.fact}` })
      }

      if (block.name === 'build_plan') {
        memory.facts.push(`Goal: ${block.input.goal}`, `Niche: ${block.input.niche}`)
        memory.rejection_round = 0
        results.push({
          type: 'tool_result', tool_use_id: block.id,
          content: `21-DAY PLAN\nGoal: ${block.input.goal}\nNiche: ${block.input.niche}\nTime: ${block.input.timePerDay} mins/day\n\nWEEK 1: Define offer, find 10 targets, write outreach, send to 5 people\nWEEK 2: Follow up, handle replies, book calls\nWEEK 3: Run calls, send proposals, close first ${block.input.goal}\n\nSTART TODAY: Write your offer in one sentence.`
        })
      }

      if (block.name === 'research') {
        const { type, query, context } = block.input
        const findings = await doResearch(type, query, context)
        results.push({ type: 'tool_result', tool_use_id: block.id, content: findings })
      }

      if (block.name === 'log_task_done') {
        memory.tasks_done = (memory.tasks_done || 0) + 1
        memory.total_earned = (memory.total_earned || 0) + (block.input.amount_earned || 0)
        memory.streak = (memory.streak || 0) + 1
        memory.last_task_at = new Date().toISOString()
        const hit100 = memory.total_earned >= 100 && (memory.total_earned - (block.input.amount_earned || 0)) < 100
        results.push({
          type: 'tool_result', tool_use_id: block.id,
          content: hit100
            ? `MILESTONE: First £100 hit! Streak: ${memory.streak} days. Total: £${memory.total_earned}. Write the celebration post now.`
            : `Task logged. Streak: ${memory.streak} days. Total earned: £${memory.total_earned}.`
        })
      }
    }
    memory.messages.push({ role: 'assistant', content: response.content })
    memory.messages.push({ role: 'user', content: results })
    saveSession(sessionId, memory)
    return await think(sessionId, '')
  }

  const reply = response.content[0].text
  memory.messages.push({ role: 'assistant', content: reply })
  saveSession(sessionId, memory)
  return reply
}

// ── Signup ────────────────────────────────────────────────────────────────
app.post('/signup', (req, res) => {
  const { name, email, gdpr_consent, sessionId = 'web-default' } = req.body
  if (!gdpr_consent) return res.status(400).json({ error: 'Consent required' })
  const store = loadStore()
  store[`user_${sessionId}`] = {
    name,
    email,
    gdpr_consent: true,
    consented_at: new Date().toISOString()
  }
  saveStore(store)
  res.json({ ok: true, name })
})

// ── Chat ──────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, sessionId = 'web-default', rejected } = req.body
  if (!message) return res.status(400).json({ error: 'No message' })
  try {
    const memory = loadSession(sessionId)
    if (rejected) memory.rejection_round = (memory.rejection_round || 0) + 1
    const isFirstReply = memory.messages.filter(m => m.role === 'assistant').length === 0
    const reply = await think(sessionId, message)
    res.json({ reply, showProfilePrompt: isFirstReply, streak: memory.streak || 0, total_earned: memory.total_earned || 0 })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ reply: "Something went wrong — try again 🦊" })
  }
})

// ── Social handle lookup (Phase 2) ────────────────────────────────────────
app.post('/lookup', async (req, res) => {
  const { handle, sessionId = 'web-default' } = req.body
  if (!handle) return res.status(400).json({ error: 'No handle' })
  try {
    const findings = await doResearch('person', handle, 'Find what this person does, their skills, niche, and any side hustle potential')
    const memory = loadSession(sessionId)
    memory.facts.push(`Social handle: ${handle}`, `Profile research: ${findings.slice(0, 200)}`)
    saveSession(sessionId, memory)
    res.json({ ok: true, summary: findings })
  } catch (err) {
    res.status(500).json({ error: 'Lookup failed' })
  }
})

// ── Task complete ─────────────────────────────────────────────────────────
app.post('/task-done', async (req, res) => {
  const { sessionId = 'web-default', description, amount = 0 } = req.body
  const reply = await think(sessionId, `I just completed: ${description}${amount ? `. I earned £${amount}.` : ''}`)
  const memory = loadSession(sessionId)
  res.json({ reply, streak: memory.streak || 0, total_earned: memory.total_earned || 0 })
})

// ── Profile ───────────────────────────────────────────────────────────────
app.post('/profile', async (req, res) => {
  const { sessionId = 'web-default', sourceType, data } = req.body
  if (!data) return res.status(400).json({ error: 'No data' })
  const analysis = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: `Extract 3-5 light patterns about this person — what they work on, their style, what they want. Brief and factual.\n\n${data.slice(0, 2000)}` }]
  })
  const summary = analysis.content[0].text
  saveProfile(sessionId, sourceType, data, summary)
  res.json({ ok: true, tags: summary })
})
app.delete('/profile', (req, res) => {
  const { sessionId = 'web-default' } = req.body
  const store = loadStore()
  delete store[`profile_${sessionId}`]
  saveStore(store)
  res.json({ ok: true })
})

// ── GDPR ──────────────────────────────────────────────────────────────────
app.get('/my-data/:sessionId', (req, res) => {
  const sid = req.params.sessionId
  const session = loadSession(sid)
  const profile = loadProfile(sid)
  const store = loadStore()
  res.json({
    user_id: sid,
    account: store[`user_${sid}`] ? { name: store[`user_${sid}`].name, email: store[`user_${sid}`].email, consented_at: store[`user_${sid}`].consented_at } : null,
    profile: profile ? { summary: profile.summary, source_type: profile.source_type, created_at: profile.created_at, deletes_after: '30 days' } : null,
    generated_facts: session.facts || [],
    streak: session.streak || 0,
    total_earned: session.total_earned || 0,
    rights: { can_export: true, can_delete: true }
  })
})
app.delete('/clear-memory', (req, res) => {
  const { sessionId = 'web-default' } = req.body
  const store = loadStore()
  if (store[sessionId]) { store[sessionId].facts = []; store[sessionId].messages = [] }
  saveStore(store)
  res.json({ ok: true })
})
app.delete('/delete-account', (req, res) => {
  const { sessionId } = req.body
  const store = loadStore()
  delete store[sessionId]
  delete store[`profile_${sessionId}`]
  delete store[`user_${sessionId}`]
  saveStore(store)
  res.json({ ok: true })
})

app.listen(PORT, () => console.log(`\n🦊 Robin running at http://localhost:${PORT}\n`))
