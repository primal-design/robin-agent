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

// ── Salary-replacing business models ─────────────────────────────────────
// These are real businesses, not pocket money gigs
// Target: £2,000–£8,000/month within 90 days

const SKILL_BUSINESSES = [
  {
    id: 'agency',
    title: 'Productised service agency',
    target: '£3,000-8,000/month',
    model: 'Sell one specific outcome (e.g. "I get local businesses 10 new Google reviews/month") for £300-500/month retainer. 10 clients = £3-5k/month.',
    first_step: 'Pick one service. Find 3 local businesses who need it. Offer the first one free in exchange for a testimonial.'
  },
  {
    id: 'consulting',
    title: 'Consulting / fractional work',
    target: '£3,000-6,000/month',
    model: 'Sell your expertise by the day or project. Day rate £300-600. 2 days/week = £2,400-4,800/month. Works if you have 3+ years in any field.',
    first_step: 'Write a one-page "what I fix and for who" doc. Post it on LinkedIn. DM 10 people who run businesses in your area.'
  },
  {
    id: 'saas_micro',
    title: 'Micro-SaaS tool',
    target: '£2,000-10,000/month',
    model: 'Build a simple tool solving one painful problem for a niche. £19-49/month subscription. 100 users = £1,900-4,900/month recurring.',
    first_step: 'Find a subreddit with 10k+ members complaining about a tool. Build the fix in 2 weeks. Launch on Product Hunt.'
  },
  {
    id: 'content_business',
    title: 'Content + audience business',
    target: '£2,000-15,000/month',
    model: 'Build an audience in a niche (newsletter, YouTube, TikTok). Monetise with sponsorships, digital products, or affiliate deals. Slow start, compounds hard.',
    first_step: 'Pick one platform. Post 3x/week for 90 days about one specific topic. Sell something to your first 100 followers.'
  },
  {
    id: 'ecom',
    title: 'Niche e-commerce / own brand',
    target: '£2,000-20,000/month',
    model: 'Source or create a product solving a specific problem. Sell on Shopify + TikTok Shop. Margin needs to be >50%. One winning product = full income.',
    first_step: 'Find a product with 1,000+ monthly searches, under 100 reviews on Amazon. Order 20 units. Test with £100 TikTok ads.'
  },
  {
    id: 'local_service_biz',
    title: 'Local service business (scale)',
    target: '£3,000-10,000/month',
    model: 'Start a local service (cleaning, landscaping, property maintenance). Hire staff once you hit £2k/month. You become the operator, not the worker.',
    first_step: 'Pick a service with £50+/hour margin. Get 5 clients. Hire one person. You manage, they deliver.'
  },
  {
    id: 'no_code_builds',
    title: 'No-code builds for businesses',
    target: '£2,500-6,000/month',
    model: 'Build automation, apps, or AI tools for businesses using no-code tools (Zapier, Make, Bubble, Glide). Charge £500-2,000 per project or retainer.',
    first_step: 'Learn one tool (Make.com) in a week. Find a local business with a manual process. Automate it for £500.'
  }
]

const ZERO_SKILL_ENTRY = [
  { id: 'reviews',  title: 'Google review management for local businesses', target: '£500-2,000/month', model: '10 clients at £100-200/month retainer. Manage their reviews, respond to feedback, chase happy customers for reviews.', first_step: 'Message 10 restaurants today. Offer a free first month.' },
  { id: 'cleaning', title: 'Commercial/end-of-tenancy cleaning', target: '£2,000-6,000/month', model: 'Charge £150-400/job. Do 3 jobs/week solo = £2k+/month. Hire one person and scale to £5k+.', first_step: 'Post on Gumtree and local Facebook groups. Offer a discounted first clean for a review.' },
  { id: 'resell',   title: 'Specialist reselling (not random junk)', target: '£1,000-4,000/month', model: 'Become the expert in ONE category (vintage clothing, tools, electronics). Buy cheap, clean, resell 3-5x. Volume is the game.', first_step: 'Pick one category. Spend £100 this weekend. List everything. See what sells.' }
]

function formatBusinessModels(ctx) {
  // If user has a skill/niche, show skill businesses. Otherwise show entry points.
  const hasSkill = ctx?.niche || ctx?.facts?.some(f => f.toLowerCase().includes('skill') || f.toLowerCase().includes('job') || f.toLowerCase().includes('work'))
  const list = hasSkill ? SKILL_BUSINESSES : [...ZERO_SKILL_ENTRY, ...SKILL_BUSINESSES.slice(0, 3)]
  return list.map(b => `- ${b.title} (${b.target}): ${b.model} | First step: ${b.first_step}`).join('\n')
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

  // Build signal scores from recent messages
  const recentText = memory.messages.slice(-10).filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '').join(' ').toLowerCase()
  const signals = {
    money_stress:    /rent|broke|need money|can't afford|bills|skint|struggling|debt|income/.test(recentText),
    skill_mention:   /i can|i'm good at|i used to|people ask me|i know how to|my background/.test(recentText),
    time_available:  /evenings|only work|spare time|free most|been slow|3 days/.test(recentText),
    task_avoidance:  /later|not sure|too many|overwhelmed|don't know where|too much/.test(recentText),
    frustration:     /tired of|stuck|bored|hate my job|going nowhere|need a change/.test(recentText),
    ambition:        /want to|thinking about|dream of|i'd love to|what if/.test(recentText),
  }

  const systemPrompt = `You are Robin.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CORE PRINCIPLE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Robin is free to talk, but paid to move your life forward.
Conversation costs nothing. Execution is where value is delivered.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
THE ROBIN LOOP
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
1. Talk freely — no agenda, just useful
2. Detect signals silently — NEVER mention you are doing this
3. When threshold met → one-line observation using their exact words
4. Offer ONE primary path + ONE alternative only
5. Execute fully — real work, not advice
6. Always ask approval before sending/posting/submitting anything
7. End every response with ONE next move — never a list
8. Show what's been done — surface progress
9. Introduce limits as "next steps ready" not "you hit a wall"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SIGNAL DETECTION (silent — never mention)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Current signal scores detected:
${Object.entries(signals).filter(([,v])=>v).map(([k])=>`  → ${k} DETECTED`).join('\n') || '  → no signals yet'}

TRIGGER RULES:
- money_stress or task_avoidance alone → trigger immediately
- 2 medium signals (skill_mention + time_available) → trigger
- 1 low signal (ambition/frustration) → ask 1 clarifying question first
- task_avoidance → skip ALL questions, give ONE move immediately

WHEN TRIGGERED — say exactly:
"You mentioned [their exact words]. That usually means there's a quick way to make progress here. Want me to map it out?"
Then show: [ Show me ] [ Not now ]
If "Not now" → drop it, never raise again this session.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SIGNAL → PRIMARY ROUTE MAPPING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
money_stress    → "Make your first £100 this week"
skill_mention   → "Turn [their skill] into a paid offer"
time_available  → "Find something that fits your [X] hours"
frustration     → "Build an exit from where you are"
ambition        → "Start the thing you mentioned"
task_avoidance  → "One move — no planning needed"
(always offer secondary: "Organise your current work better")

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXECUTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BUSINESS (not gigs) — reject any idea that:
- Pays only for time, no repeat potential
- Cannot scale beyond their own hours
- Earns less than £25/hour at realistic volume
- Is structurally a job, not a business

Prefer ideas that:
- Can be packaged as a service with recurring revenue
- Use knowledge/access not just labour
- Have a path to £500/month within 60 days
- Can eventually run without the founder doing every task

BUSINESS MODELS AVAILABLE:
${formatBusinessModels(ctx)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BEHAVIOUR RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Max 1 clarifying question before acting. When in doubt: act.
- Never present 3+ equal options. ONE path + ONE alternative.
- Never say "great question", "certainly", "I'm here to help"
- Never say "that's not what I do" — adapt and help
- task_avoidance → "Let's skip thinking. One move:" then give it
- Return users → treat as Day N not Day 1, reference last session
- If URL sent and readable → use content immediately
- If URL not readable → "Can't open that — what's your job title?"
- End every message with 🦊

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
APPROVAL MATRIX
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
AUTO-EXECUTE: ${PERMISSIONS.AUTO.join(', ')}
NEEDS APPROVAL: ${PERMISSIONS.NEEDS_APPROVAL.join(', ')}
NEVER: ${PERMISSIONS.NEVER.join(', ')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
USER CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
goal_mode: ${ctx.goal || 'not set'}
streak: ${ctx.streak} days | earned: £${ctx.total_earned} | tasks: ${ctx.tasks_done}
silence: ${Math.round(ctx.silence_hours)}h | streak_at_risk: ${ctx.streak_at_risk}
known facts: ${ctx.facts?.join(', ') || 'none yet'}
${ctx.profile_summary ? `profile: ${ctx.profile_summary}` : ''}
${urlContext}
${rejectCtx}
${skillContext ? `active skills: ${skillContext}` : ''}`

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
// ── Business Analysis ─────────────────────────────────────────────────────
app.post('/analyse', async (req, res) => {
  const { idea, sessionId = 'web-default' } = req.body
  if (!idea) return res.status(400).json({ error: 'No idea' })

  // Stream layers back as they complete
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (layer, content) => {
    res.write(`data: ${JSON.stringify({ layer, content })}\n\n`)
  }

  try {
    send('status', 'Running demand check...')

    // Layer 2: Demand
    const demand = await doResearch('trend', idea, 'Is there growing demand? Are people searching for this? What are they saying on Reddit/social?')
    send('demand', demand)

    send('status', 'Researching competitors...')

    // Layer 4: Competition
    const competition = await doResearch('competitor', idea, 'Top competitors, their pricing, what reviews say they are bad at, gaps in the market')
    send('competition', competition)

    send('status', 'Analysing market...')

    // Layer 3+5: Market + PESTEL signals
    const market = await doResearch('market', idea, 'Market size, TAM, growth rate, PESTEL risks — regulation, tech disruption, social trends')
    send('market', market)

    send('status', 'Checking keywords...')

    // Layer 10: Keywords
    const keywords = await doResearch('topic', `${idea} keywords SEO`, 'Top search keywords, content gaps, what ads competitors are running')
    send('keywords', keywords)

    // Layer 6-9: Synthesis — SWOT + ICP + Unit Economics + Verdict
    send('status', 'Building your analysis...')
    const synthesis = await ai.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      messages: [{
        role: 'user',
        content: `You are Robin — a sharp business analyst. Analyse this idea: "${idea}"

Research gathered:
DEMAND: ${demand}
COMPETITION: ${competition}
MARKET: ${market}
KEYWORDS: ${keywords}

Now give a structured analysis covering:
1. SWOT (4 bullets each — specific to this idea)
2. ICP — describe the ideal customer in 3 sentences (age, pain, where they hang out)
3. Unit Economics — realistic price point, estimated margin, CAC challenge
4. Verdict — GO / GO WITH CHANGES / VALIDATE FIRST / STOP + one-line reason
5. ONE next step — the single most important thing to do in the next 48 hours

Be brutally honest. Specific. No generic advice. Max 300 words total.`
      }]
    })
    send('analysis', synthesis.content[0].text)

    // Save to session memory
    const memory = loadSession(sessionId)
    memory.facts.push(`Business idea analysed: ${idea}`)
    saveSession(sessionId, memory)

    send('done', 'Analysis complete')
    res.end()
  } catch (err) {
    send('error', 'Analysis failed — ' + err.message)
    res.end()
  }
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
