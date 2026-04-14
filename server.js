import 'dotenv/config'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'
import {
  buildUserContext, autonomousDecision, checkTriggers,
  handleApproval, hoursSince, PERMISSIONS, canAutoExecute
} from './brain.js'

const __dir = dirname(fileURLToPath(import.meta.url))
const ai    = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })

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
  return readdirSync(skillsDir).filter(f => f.endsWith('.md')).map(f => {
    const { data, content } = matter(readFileSync(join(skillsDir, f), 'utf8'))
    return { ...data, content }
  })
}
function getRelevantSkills(message) {
  const lower = message.toLowerCase()
  return loadSkills()
    .filter(s => (s.triggers || []).some(t => lower.includes(t.toLowerCase())))
    .map(s => `## Skill: ${s.name}\n${s.content}`)
    .join('\n\n')
}

const app  = express()
const PORT = process.env.PORT || 3000
app.use(express.json({ limit: '2mb' }))
app.use((req, res, next) => { res.removeHeader('Content-Security-Policy'); next() })
app.use(express.static(new URL('.', import.meta.url).pathname))
app.get('/', (_, res) => res.sendFile(new URL('index.html', import.meta.url).pathname))

// ── Storage ───────────────────────────────────────────────────────────────
function loadStore() {
  return existsSync('memory.json') ? JSON.parse(readFileSync('memory.json', 'utf8')) : {}
}
function saveStore(s) { writeFileSync('memory.json', JSON.stringify(s, null, 2)) }
function loadSession(id) {
  return loadStore()[id] || { messages: [], facts: [], streak: 0, tasks_done: 0, total_earned: 0, rejection_round: 0 }
}
function saveSession(id, data) {
  const s = loadStore()
  s[id] = { ...data, lastActive: new Date().toISOString() }
  saveStore(s)
}
function loadProfile(sessionId) {
  const p = loadStore()[`profile_${sessionId}`]
  if (!p) return null
  if (Date.now() - new Date(p.created_at).getTime() > 30 * 24 * 60 * 60 * 1000) {
    const s = loadStore(); delete s[`profile_${sessionId}`]; saveStore(s); return null
  }
  return p
}
function saveProfile(sessionId, sourceType, rawData, summary) {
  const s = loadStore()
  s[`profile_${sessionId}`] = { source_type: sourceType, raw_data: rawData.slice(0, 5000), summary, created_at: new Date().toISOString() }
  saveStore(s)
}

// ── Research engine ───────────────────────────────────────────────────────
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
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`, { headers: { 'X-Subscription-Token': process.env.BRAVE_KEY, 'Accept': 'application/json' } })
    const data = await res.json()
    return (data.web?.results || []).map(r => `• ${r.title}: ${r.description}`).join('\n')
  } catch { return null }
}
async function doResearch(type, query, context = '') {
  const queries = RESEARCH_QUERIES[type]?.(query) || [query]
  let raw = `Research type: ${type}\nQuery: ${query}\n\n`
  if (process.env.BRAVE_KEY) {
    for (const q of queries) { const r = await braveSearch(q); if (r) raw += `Search: "${q}"\n${r}\n\n` }
  } else { raw += '(No Brave key — using Claude knowledge only)\n\n' }
  const s = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 600,
    messages: [{ role: 'user', content: `Research: "${query}" (${type}).\n${context ? `Why: ${context}\n` : ''}Data:\n${raw}\nSharp summary, bullet points, max 5 insights. Focus on what's actionable.` }]
  })
  return s.content[0].text
}

// ── Rejection tree context ────────────────────────────────────────────────
function rejectionContext(round) {
  if (round === 0) return ''
  if (round === 1) return `\nUSER REJECTED FIRST SUGGESTION. Ask one filter: online or in-person? solo or with people? Then give 3 different options — different category, never repeat.`
  if (round === 2) return `\nUSER REJECTED TWICE. One final filter: how much time per day? Then give 3 final very specific options with exact first steps.`
  return `\nNUCLEAR OPTION. No more questions. Say: "Tell me one thing you did this week — anything. I'll find the money in it."`
}

// ── Robin brain ───────────────────────────────────────────────────────────
async function think(sessionId, userMessage, options = {}) {
  const memory  = loadSession(sessionId)
  const profile = loadProfile(sessionId)

  if (userMessage) memory.messages.push({ role: 'user', content: userMessage })

  // Full context window — not just facts, full ambient state
  const ctx          = buildUserContext(memory, profile)
  const skillContext = userMessage ? getRelevantSkills(userMessage) : ''
  const rejectCtx    = rejectionContext(memory.rejection_round || 0)

  // Escalate to Sonnet for first 3 turns, then Haiku
  const msgCount = memory.messages.filter(m => m.role === 'assistant').length
  const model    = msgCount < 3 ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'

  // Detect approval signals
  const approvalSignals = ['yes', 'do it', 'go ahead', 'send it', 'go for it', 'approved', 'yep', 'yeah do it']
  const isApproval = userMessage && approvalSignals.some(s => userMessage.toLowerCase().includes(s))
  if (isApproval && memory.pending_action) {
    const result = await handleApproval(sessionId, memory.pending_action, memory)
    memory.pending_action = null
    const reply = result.followup
    memory.messages.push({ role: 'assistant', content: reply })
    saveSession(sessionId, memory)
    return reply
  }

  // Detect if user sent a URL — fetch its content to give Robin real data
  let urlContext = ''
  if (userMessage) {
    const urlMatch = userMessage.match(/https?:\/\/[^\s]+/)
    if (urlMatch) {
      try {
        const pageRes = await fetch(urlMatch[0], { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) })
        const html = await pageRes.text()
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000)
        urlContext = `\nURL content from ${urlMatch[0]}:\n${text}`
      } catch { urlContext = `\nUser sent a URL (${urlMatch[0]}) but I could not fetch it — do NOT pretend I read it. Tell the user I can't open that link and ask them to paste the key info directly.` }
    }
  }

  const systemPrompt = `You are Robin — a side hustle mentor. Your one job: get people to their first £100.

RULES:
- Max 2 sentences. Never more. No lists. No bullet points.
- NEVER ask two questions in a row — give something first, then ask ONE question.
- If they send a URL you couldn't read → say "I can't open that link — what's your main skill or job title?" Do NOT pretend you read it.
- If they send a URL you DID read → use the actual content to give a specific hustle recommendation immediately.
- If they need money → ask ONE thing: what can they do?
- If no skills → pick ONE hustle from zero-skill list and give one action TODAY.
- If frustrated → skip sympathy, give one action RIGHT NOW.
- Once you know skill/niche → name the hustle, the buyer, the price. Be specific.
- Never say "great question", "I'm here to help", or anything corporate.
- Only build a full 21-day plan when they say "build", "let's go", "make me a plan".
- End every message with 🦊
${urlContext}
${rejectCtx}

PERMISSION MATRIX:
- You AUTO-EXECUTE: ${PERMISSIONS.AUTO.join(', ')}
- You DRAFT AND ASK APPROVAL FOR: ${PERMISSIONS.NEEDS_APPROVAL.join(', ')}
- You NEVER DO: ${PERMISSIONS.NEVER.join(', ')}

When you draft something that needs approval (outreach, post, payment link), save it as pending_action and ask "Want me to send this?" before executing.

ZERO-SKILL HUSTLES:
${formatZeroSkillHustles()}

${skillContext ? `ACTIVE SKILLS:\n${skillContext}` : ''}

FULL USER CONTEXT:
${JSON.stringify(ctx, null, 2)}`

  const response = await ai.messages.create({
    model,
    max_tokens: 1000,
    system: systemPrompt,
    tools: [
      { name: 'remember_fact',    description: 'Remember a fact about the user', input_schema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
      { name: 'update_milestone', description: 'Mark a milestone as complete',   input_schema: { type: 'object', properties: { milestone: { type: 'string' }, earned: { type: 'number' } }, required: ['milestone'] } },
      { name: 'generate_plan',    description: 'Build a 21-day action plan',     input_schema: { type: 'object', properties: { goal: { type: 'string' }, niche: { type: 'string' }, timePerDay: { type: 'number' } }, required: ['goal', 'niche', 'timePerDay'] } },
      { name: 'draft_content',    description: 'Draft outreach, posts, or messages for user approval', input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['outreach', 'social_post', 'email'] }, recipient: { type: 'string' }, content: { type: 'string' } }, required: ['type', 'content'] } },
      {
        name: 'research',
        description: 'Research a person, market, topic, competitor, or trend. AUTO-EXECUTES.',
        input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['person', 'market', 'topic', 'competitor', 'trend'] }, query: { type: 'string' }, context: { type: 'string' } }, required: ['type', 'query'] }
      },
      { name: 'log_task_done',    description: 'User completed a task. Log it, update streak.',      input_schema: { type: 'object', properties: { task_description: { type: 'string' }, amount_earned: { type: 'number' } }, required: ['task_description'] } },
    ],
    messages: memory.messages.slice(-20)
  })

  if (response.stop_reason === 'tool_use') {
    const results = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const { name, input, id } = block

      if (name === 'remember_fact') {
        memory.facts.push(input.fact)
        results.push({ type: 'tool_result', tool_use_id: id, content: `Saved: ${input.fact}` })
      }

      if (name === 'update_milestone') {
        memory.milestones = memory.milestones || []
        memory.milestones.push({ milestone: input.milestone, done: true, at: new Date().toISOString() })
        if (input.earned) memory.total_earned = (memory.total_earned || 0) + input.earned
        results.push({ type: 'tool_result', tool_use_id: id, content: `Milestone logged: ${input.milestone}` })
      }

      if (name === 'generate_plan') {
        memory.facts.push(`Goal: ${input.goal}`, `Niche: ${input.niche}`)
        memory.rejection_round = 0
        results.push({
          type: 'tool_result', tool_use_id: id,
          content: `21-DAY PLAN\nGoal: ${input.goal}\nNiche: ${input.niche}\nTime: ${input.timePerDay} mins/day\n\nWEEK 1: Define offer → find 10 targets → write outreach → send to 5 people\nWEEK 2: Follow up → handle replies → book calls\nWEEK 3: Run calls → send proposals → close first ${input.goal}\n\nSTART TODAY: Write your offer in one sentence.`
        })
      }

      if (name === 'draft_content') {
        // Needs approval — save as pending, don't auto-send
        memory.pending_action = { type: 'send_message', draft: input.content, recipient: input.recipient || 'your contact', content_type: input.type }
        results.push({
          type: 'tool_result', tool_use_id: id,
          content: `DRAFT READY (needs approval):\n\n${input.content}\n\nAsk user: "Want me to send this?"`
        })
      }

      if (name === 'research') {
        const findings = await doResearch(input.type, input.query, input.context)
        results.push({ type: 'tool_result', tool_use_id: id, content: findings })
      }

      if (name === 'log_task_done') {
        memory.tasks_done   = (memory.tasks_done || 0) + 1
        memory.total_earned = (memory.total_earned || 0) + (input.amount_earned || 0)
        memory.streak       = (memory.streak || 0) + 1
        const hit100 = memory.total_earned >= 100 && (memory.total_earned - (input.amount_earned || 0)) < 100
        results.push({
          type: 'tool_result', tool_use_id: id,
          content: hit100
            ? `MILESTONE: First £100 hit! Streak: ${memory.streak}. Total: £${memory.total_earned}. Write the win post.`
            : `Task logged. Streak: ${memory.streak} days. Total: £${memory.total_earned}.`
        })
      }
    }

    memory.messages.push({ role: 'assistant', content: response.content })
    memory.messages.push({ role: 'user', content: results })
    saveSession(sessionId, memory)
    return await think(sessionId, '', options)
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
  const s = loadStore()
  s[`user_${sessionId}`] = { name, email, gdpr_consent: true, consented_at: new Date().toISOString() }
  saveStore(s)
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
    const updated = loadSession(sessionId)
    res.json({ reply, showProfilePrompt: isFirstReply, streak: updated.streak || 0, total_earned: updated.total_earned || 0 })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ reply: "Something went wrong — try again 🦊" })
  }
})

// ── Autonomous trigger check (called by cron or /pulse) ──────────────────
app.post('/pulse', async (req, res) => {
  const { sessionId } = req.body
  if (!sessionId) return res.status(400).json({ error: 'No sessionId' })
  try {
    const memory  = loadSession(sessionId)
    const profile = loadProfile(sessionId)
    const ctx     = buildUserContext(memory, profile)

    // Check state-based triggers
    const fired = checkTriggers(ctx)
    if (fired.length > 0) {
      const trigger = fired[0]
      const message = trigger.message(ctx)
      return res.json({ triggered: true, trigger: trigger.name, message })
    }

    // No trigger — autonomous decision
    const decision = await autonomousDecision(sessionId, memory, profile)
    if (decision.action !== 'NOTHING') {
      return res.json({ triggered: true, trigger: decision.action, message: decision.message })
    }

    res.json({ triggered: false })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ error: 'Pulse failed' })
  }
})

// ── Social handle lookup ──────────────────────────────────────────────────
app.post('/lookup', async (req, res) => {
  const { handle, sessionId = 'web-default' } = req.body
  if (!handle) return res.status(400).json({ error: 'No handle' })
  try {
    const findings = await doResearch('person', handle, 'Skills, niche, side hustle potential')
    const memory   = loadSession(sessionId)
    memory.facts.push(`Social handle: ${handle}`, `Profile: ${findings.slice(0, 200)}`)
    saveSession(sessionId, memory)
    res.json({ ok: true, summary: findings })
  } catch { res.status(500).json({ error: 'Lookup failed' }) }
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
    model: 'claude-haiku-4-5-20251001', max_tokens: 300,
    messages: [{ role: 'user', content: `Extract 3-5 patterns about this person — what they do, their style, what they want. Brief.\n\n${data.slice(0, 2000)}` }]
  })
  saveProfile(sessionId, sourceType, data, analysis.content[0].text)
  res.json({ ok: true, tags: analysis.content[0].text })
})
app.delete('/profile', (req, res) => {
  const { sessionId = 'web-default' } = req.body
  const s = loadStore(); delete s[`profile_${sessionId}`]; saveStore(s)
  res.json({ ok: true })
})

// ── GDPR ──────────────────────────────────────────────────────────────────
app.get('/my-data/:sessionId', (req, res) => {
  const sid     = req.params.sessionId
  const session = loadSession(sid)
  const profile = loadProfile(sid)
  const store   = loadStore()
  res.json({
    user_id:    sid,
    account:    store[`user_${sid}`] ? { name: store[`user_${sid}`].name, email: store[`user_${sid}`].email, consented_at: store[`user_${sid}`].consented_at } : null,
    profile:    profile ? { summary: profile.summary, source_type: profile.source_type, created_at: profile.created_at, deletes_after: '30 days' } : null,
    facts:      session.facts || [],
    milestones: session.milestones || [],
    streak:     session.streak || 0,
    total_earned: session.total_earned || 0,
    rights:     { can_export: true, can_delete: true }
  })
})
app.delete('/clear-memory', (req, res) => {
  const { sessionId = 'web-default' } = req.body
  const s = loadStore()
  if (s[sessionId]) { s[sessionId].facts = []; s[sessionId].messages = [] }
  saveStore(s); res.json({ ok: true })
})
app.delete('/delete-account', (req, res) => {
  const { sessionId } = req.body
  const s = loadStore()
  delete s[sessionId]; delete s[`profile_${sessionId}`]; delete s[`user_${sessionId}`]
  saveStore(s); res.json({ ok: true })
})

// ── TTS — Robin speaks ────────────────────────────────────────────────────
app.post('/speak', async (req, res) => {
  const { text } = req.body
  if (!text) return res.status(400).json({ error: 'No text' })

  // Strip emoji for cleaner speech
  const clean = text.replace(/[\u{1F300}-\u{1FAFF}]/gu, '').replace(/🦊/g, '').trim()

  try {
    if (process.env.OPENAI_KEY) {
      // OpenAI TTS — best quality
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'tts-1', voice: 'onyx', input: clean, speed: 1.0 })
      })
      if (response.ok) {
        res.setHeader('Content-Type', 'audio/mpeg')
        return response.body.pipe(res)
      }
    }
    // Fallback: tell client to use browser TTS
    res.json({ fallback: true, text: clean })
  } catch (err) {
    res.json({ fallback: true, text: clean })
  }
})

app.listen(PORT, () => console.log(`\n🦊 Robin running at http://localhost:${PORT}\n`))
