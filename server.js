import 'dotenv/config'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'

const __dir = dirname(fileURLToPath(import.meta.url))

const ai  = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })

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
  return store[id] || { messages: [], facts: [] }
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
  const queries = RESEARCH_QUERIES[type]?.(query) || [`${query}`]
  let raw = `Research type: ${type}\nQuery: ${query}\n\n`

  if (process.env.BRAVE_KEY) {
    for (const q of queries) {
      const results = await braveSearch(q)
      if (results) raw += `Search: "${q}"\n${results}\n\n`
    }
  } else {
    raw += '(No Brave key — using Claude knowledge only)\n\n'
  }

  // Synthesise with Claude
  const synthesis = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{
      role: 'user',
      content: `You are helping someone research: "${query}" (type: ${type}).
${context ? `Why they need it: ${context}` : ''}

Raw search data:
${raw}

Give a sharp, useful summary. Focus on what's most actionable for this person. Use bullet points. Max 5 key insights.`
    }]
  })

  return synthesis.content[0].text
}

// ── Robin brain ───────────────────────────────────────────────────────────
async function think(sessionId, userMessage) {
  const memory  = loadSession(sessionId)
  const profile = loadProfile(sessionId)

  if (userMessage) memory.messages.push({ role: 'user', content: userMessage })

  const profileContext = profile
    ? `\nUser profile (uploaded by user):\n${profile.summary}` : ''

  const skillContext = userMessage ? getRelevantSkills(userMessage) : ''
  const skillsSection = skillContext ? `\n\n# Active Skills\n${skillContext}` : ''

  const response = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    system: `You're Robin — a real one. Sharp, laid-back, someone who actually listens before jumping in.
You talk like a real person — casual, warm, direct. No corporate energy.
Your first job is to understand the person you're talking to. Get to know them. What are they working on, what's their situation, what do they actually want. Build that connection naturally through conversation.
Don't rush to build plans or take action unless the user explicitly asks for it — words like "build", "make me a plan", "let's go", "set it up" are your signal to act.
Until then, just vibe, get to know them, ask one good question at a time.
Three sentences max per reply. End every message with 🦊

Current time: ${new Date().toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true })}
What you know about this user: ${memory.facts.join(', ') || 'nothing yet'}${profileContext}${skillsSection}`,
    tools: [
      { name: 'remember_fact', description: 'Remember a fact about the user', input_schema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
      { name: 'build_plan', description: 'Build a 21 day action plan', input_schema: { type: 'object', properties: { goal: { type: 'string' }, niche: { type: 'string' }, timePerDay: { type: 'number' } }, required: ['goal', 'niche', 'timePerDay'] } },
      {
        name: 'research',
        description: `Do research when the user asks. First determine the type:
- person: researching a specific individual (competitor, potential client, influencer)
- market: researching an industry, niche, or market opportunity
- topic: researching a concept, strategy, or how-to
- competitor: researching a business or product
- trend: researching what's currently popular or emerging
Pick the most relevant type and run focused searches.`,
        input_schema: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['person', 'market', 'topic', 'competitor', 'trend'] },
            query: { type: 'string', description: 'The main search query' },
            context: { type: 'string', description: 'Why the user needs this — shapes what to look for' }
          },
          required: ['type', 'query']
        }
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
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `21-DAY PLAN\nGoal: ${block.input.goal}\nNiche: ${block.input.niche}\nTime: ${block.input.timePerDay} mins/day\n\nWEEK 1: Define offer, find 10 targets, write outreach, send to 5 people\nWEEK 2: Follow up, handle replies, book calls\nWEEK 3: Run calls, send proposals, close first ${block.input.goal}\n\nSTART TODAY: Write your offer in one sentence.` })
      }
      if (block.name === 'research') {
        const { type, query, context } = block.input
        const findings = await doResearch(type, query, context)
        results.push({ type: 'tool_result', tool_use_id: block.id, content: findings })
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

// ── Chat ──────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, sessionId = 'web-default' } = req.body
  if (!message) return res.status(400).json({ error: 'No message' })
  try {
    const memory = loadSession(sessionId)
    const isFirstReply = memory.messages.filter(m => m.role === 'assistant').length === 0
    const reply = await think(sessionId, message)
    res.json({ reply, showProfilePrompt: isFirstReply })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ reply: "Something went wrong — try again 🦊" })
  }
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

// ── /my-data (GDPR export — memory.json version) ──────────────────────────
app.get('/my-data/:sessionId', (req, res) => {
  const sid = req.params.sessionId
  const session = loadSession(sid)
  const profile = loadProfile(sid)
  res.json({
    user_id: sid,
    profile: profile ? { summary: profile.summary, source_type: profile.source_type, created_at: profile.created_at, deletes_after: '30 days' } : null,
    generated_facts: session.facts || [],
    rights: { can_export: true, can_delete: true }
  })
})

app.delete('/delete-account', (req, res) => {
  const { sessionId } = req.body
  const store = loadStore()
  delete store[sessionId]
  delete store[`profile_${sessionId}`]
  saveStore(store)
  res.json({ ok: true })
})

app.listen(PORT, () => {
  console.log(`\n🦊 Robin running at http://localhost:${PORT}\n`)
})
