import 'dotenv/config'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'
import {
  buildUserContext, autonomousDecision, checkTriggers,
  handleApproval, hoursSince, PERMISSIONS, canAutoExecute
} from './brain.js'
import {
  loadSession, saveSession, loadProfile, saveProfile, deleteProfile,
  loadUser, saveUser, exportUserData, deleteAccount, clearMemory
} from './lib/db.js'
import {
  detectSignals, shouldTrigger, getTriggerRoute
} from './lib/signals.js'
import {
  getAuthUrl, exchangeCode, listEmails, getEmailBody,
  sendEmail, archiveEmails, markRead, findContact,
  getLatestId, getEmailProfile
} from './lib/gmail.js'

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
app.use(express.urlencoded({ extended: false }))
app.use((req, res, next) => { res.removeHeader('Content-Security-Policy'); next() })
app.use(express.static(new URL('.', import.meta.url).pathname))
app.use('/frontend', express.static(new URL('frontend', import.meta.url).pathname))
app.get('/', (_, res) => res.sendFile(new URL('frontend/robin_site.html', import.meta.url).pathname))

// Storage is now handled by lib/db.js (Upstash Redis + memory.json fallback)

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
    const doneId = memory.pending_action.id
    memory.pending_action = null
    memory.pending_actions = (memory.pending_actions || []).filter(a => a.id !== doneId)
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
      { name: 'find_leads',       description: 'Find local business leads using Google Maps. Use when user wants to find clients or prospects in their area.', input_schema: { type: 'object', properties: { niche: { type: 'string', description: 'Type of business e.g. restaurants, gyms, hair salons' }, location: { type: 'string', description: 'City or area e.g. Manchester, London Bridge' } }, required: ['niche', 'location'] } },
      { name: 'read_emails',      description: 'Read emails from the user\'s Gmail inbox. Use for: checking new emails, today\'s emails, unread emails, emails from a specific person.', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Gmail search query e.g. "from:john" or "newer_than:1d" or "is:unread"' }, maxResults: { type: 'number' }, unreadOnly: { type: 'boolean' } }, required: [] } },
      { name: 'draft_email',      description: 'Draft an email for user approval before sending. Always draft first, never send without approval.', input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, find_contact: { type: 'string', description: 'Name to look up in contacts if email address not known' } }, required: ['subject', 'body'] } },
      { name: 'send_email',       description: 'Send a previously approved email draft. Only call after user says yes/send/go ahead.', input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, threadId: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
      { name: 'clean_inbox',      description: 'Archive emails to clean the inbox. Use when user asks to clean, tidy, or clear emails.', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Which emails to archive e.g. "older_than:30d" or "from:newsletter"' }, maxResults: { type: 'number' } }, required: ['query'] } },
      { name: 'email_summary',    description: 'Summarise all emails from today or this week. Use for daily digest requests.', input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'week'] } }, required: ['period'] } },
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
        memory.pending_actions = memory.pending_actions || []
        const action = { id: Date.now().toString(), type: 'send_message', draft: input.content, recipient: input.recipient || 'your contact', content_type: input.type, risk: 'medium', created_at: new Date().toISOString() }
        memory.pending_actions.push(action)
        memory.pending_action = action
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

      if (name === 'find_leads') {
        const leads = await findLocalLeads(input.niche, input.location)
        memory.leads = leads
        if (leads.length) {
          const formatted = leads.map((l, i) =>
            `${i+1}. ${l.name} — ${l.address} | ⭐ ${l.rating || 'no rating'} (${l.reviews || 0} reviews)`
          ).join('\n')
          results.push({ type: 'tool_result', tool_use_id: id, content: `Found ${leads.length} ${input.niche} businesses in ${input.location}:\n${formatted}\n\nBest targets: low rating (3-4 stars) or few reviews = easiest to help and most likely to pay.` })
        } else {
          results.push({ type: 'tool_result', tool_use_id: id, content: `No results found for ${input.niche} in ${input.location}. Try a broader term or different area.` })
        }
      }

      // ── Email tools ───────────────────────────────────────────────────────
      if (name === 'read_emails') {
        const tokens = await getEmailTokens(sessionId)
        if (!tokens) {
          results.push({ type: 'tool_result', tool_use_id: id, content: 'Gmail not connected. Ask the user to connect Gmail in Settings first.' })
        } else {
          try {
            const emails = await listEmails(tokens, { query: input.query || '', maxResults: input.maxResults || 15, unreadOnly: input.unreadOnly })
            if (!emails.length) {
              results.push({ type: 'tool_result', tool_use_id: id, content: 'No emails found matching that query.' })
            } else {
              const formatted = emails.map((e, i) =>
                `${i+1}. ${e.unread ? '🔵 ' : ''}From: ${e.from}\n   Subject: ${e.subject}\n   Date: ${e.date}\n   Preview: ${e.snippet}`
              ).join('\n\n')
              results.push({ type: 'tool_result', tool_use_id: id, content: `Found ${emails.length} email(s):\n\n${formatted}` })
            }
          } catch (err) {
            results.push({ type: 'tool_result', tool_use_id: id, content: `Email read failed: ${err.message}` })
          }
        }
      }

      if (name === 'draft_email') {
        const tokens = await getEmailTokens(sessionId)
        if (!tokens) {
          results.push({ type: 'tool_result', tool_use_id: id, content: 'Gmail not connected.' })
        } else {
          let to = input.to || ''
          // Auto-find contact if email not provided
          if (!to && input.find_contact) {
            try {
              const contacts = await findContact(tokens, input.find_contact)
              if (contacts.length) to = contacts[0].email
            } catch {}
          }
          // Save draft as pending action
          memory.pending_actions = memory.pending_actions || []
          const emailAction = { id: Date.now().toString(), type: 'draft_email', to, subject: input.subject, body: input.body, risk: 'medium', created_at: new Date().toISOString() }
          memory.pending_actions.push(emailAction)
          memory.pending_action = emailAction
          const preview = `To: ${to || '(contact not found — please provide email)'}\nSubject: ${input.subject}\n\n${input.body}`
          results.push({ type: 'tool_result', tool_use_id: id, content: `DRAFT READY:\n\n${preview}\n\nAsk user: "Want me to send this?"` })
        }
      }

      if (name === 'send_email') {
        const tokens = await getEmailTokens(sessionId)
        if (!tokens) {
          results.push({ type: 'tool_result', tool_use_id: id, content: 'Gmail not connected.' })
        } else {
          try {
            await sendEmail(tokens, { to: input.to, subject: input.subject, body: input.body, threadId: input.threadId })
            const sentId = memory.pending_action?.id
            memory.pending_action = null
            memory.pending_actions = (memory.pending_actions || []).filter(a => a.id !== sentId)
            results.push({ type: 'tool_result', tool_use_id: id, content: `Email sent to ${input.to}. Subject: "${input.subject}"` })
          } catch (err) {
            results.push({ type: 'tool_result', tool_use_id: id, content: `Send failed: ${err.message}` })
          }
        }
      }

      if (name === 'clean_inbox') {
        const tokens = await getEmailTokens(sessionId)
        if (!tokens) {
          results.push({ type: 'tool_result', tool_use_id: id, content: 'Gmail not connected.' })
        } else {
          try {
            const emails = await listEmails(tokens, { query: input.query, maxResults: input.maxResults || 50 })
            if (!emails.length) {
              results.push({ type: 'tool_result', tool_use_id: id, content: 'No emails matched — inbox already clean.' })
            } else {
              await archiveEmails(tokens, emails.map(e => e.id))
              results.push({ type: 'tool_result', tool_use_id: id, content: `Archived ${emails.length} emails matching "${input.query}". Inbox cleaned.` })
            }
          } catch (err) {
            results.push({ type: 'tool_result', tool_use_id: id, content: `Clean failed: ${err.message}` })
          }
        }
      }

      if (name === 'email_summary') {
        const tokens = await getEmailTokens(sessionId)
        if (!tokens) {
          results.push({ type: 'tool_result', tool_use_id: id, content: 'Gmail not connected.' })
        } else {
          try {
            const query = input.period === 'week' ? 'newer_than:7d' : 'newer_than:1d'
            const emails = await listEmails(tokens, { query, maxResults: 30 })
            if (!emails.length) {
              results.push({ type: 'tool_result', tool_use_id: id, content: `No emails in the last ${input.period === 'week' ? '7 days' : '24 hours'}.` })
            } else {
              const unread = emails.filter(e => e.unread).length
              const senders = [...new Set(emails.map(e => e.from.replace(/<.*>/, '').trim()))].slice(0, 8)
              const list = emails.slice(0, 15).map(e => `- ${e.unread ? '🔵 ' : ''}${e.from.replace(/<.*>/, '').trim()}: "${e.subject}" — ${e.snippet?.slice(0, 80)}`)
              results.push({ type: 'tool_result', tool_use_id: id, content: `${input.period === 'week' ? 'This week' : 'Today'}: ${emails.length} emails, ${unread} unread.\nFrom: ${senders.join(', ')}\n\n${list.join('\n')}` })
            }
          } catch (err) {
            results.push({ type: 'tool_result', tool_use_id: id, content: `Summary failed: ${err.message}` })
          }
        }
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
app.post('/signup', async (req, res) => {
  const { name, email, gdpr_consent, sessionId = 'web-default' } = req.body
  if (!gdpr_consent) return res.status(400).json({ error: 'Consent required' })
  await saveUser(sessionId, { name, email, gdpr_consent: true, consented_at: new Date().toISOString() })
  res.json({ ok: true, name })
})

// ── Chat (streaming + signal/trigger/paywall) ─────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, sessionId = 'web-default', rejected } = req.body
  if (!message) return res.status(400).json({ error: 'No message' })
  try {
    const memory = await loadSession(sessionId)
    if (rejected) memory.rejection_round = (memory.rejection_round || 0) + 1
    const isFirstReply = memory.messages.filter(m => m.role === 'assistant').length === 0

    // Signal detection
    memory.messages.push({ role: 'user', content: message })
    const signals = detectSignals(memory.messages)
    const triggered = shouldTrigger(signals) && !memory.trigger_shown
    const route = triggered ? getTriggerRoute(signals) : null
    if (triggered) memory.trigger_shown = true

    memory.messages.pop() // think() will re-add
    const reply = await think(sessionId, message)
    const updated = await loadSession(sessionId)

    res.json({
      type: 'response',
      reply,
      showProfilePrompt: isFirstReply,
      streak:       updated.streak || 0,
      total_earned: updated.total_earned || 0,
      signals:      Object.keys(signals),
      trigger:      route,
      smartCallsLeft: Math.max(0, 10 - (updated.smart_calls_used || 0))
    })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ type: 'error', reply: "Something went wrong — try again 🦊" })
  }
})

// ── Autonomous trigger check ──────────────────────────────────────────────
app.post('/pulse', async (req, res) => {
  const { sessionId } = req.body
  if (!sessionId) return res.status(400).json({ error: 'No sessionId' })
  try {
    const memory  = await loadSession(sessionId)
    const profile = await loadProfile(sessionId)
    const ctx     = buildUserContext(memory, profile)
    const fired   = checkTriggers(ctx)
    if (fired.length > 0) {
      const trigger = fired[0]
      return res.json({ triggered: true, trigger: trigger.name, message: trigger.message(ctx) })
    }
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
    const memory   = await loadSession(sessionId)
    memory.facts.push(`Social handle: ${handle}`, `Profile: ${findings.slice(0, 200)}`)
    await saveSession(sessionId, memory)
    res.json({ ok: true, summary: findings })
  } catch { res.status(500).json({ error: 'Lookup failed' }) }
})

// ── Google Maps — find local business leads ───────────────────────────────
async function findLocalLeads(niche, location, limit = 10) {
  if (!process.env.GOOGLE_MAPS_KEY) return []
  try {
    const query = encodeURIComponent(`${niche} in ${location}`)
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${process.env.GOOGLE_MAPS_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    return (data.results || []).slice(0, limit).map(p => ({
      name:    p.name,
      address: p.formatted_address,
      rating:  p.rating,
      reviews: p.user_ratings_total,
      place_id: p.place_id
    }))
  } catch { return [] }
}

async function getPlaceDetails(placeId) {
  if (!process.env.GOOGLE_MAPS_KEY) return null
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website,rating,reviews,formatted_address&key=${process.env.GOOGLE_MAPS_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    return data.result || null
  } catch { return null }
}

app.post('/find-leads', async (req, res) => {
  const { niche, location, sessionId = 'web-default' } = req.body
  if (!niche || !location) return res.status(400).json({ error: 'Need niche and location' })
  try {
    const leads = await findLocalLeads(niche, location)
    if (!leads.length) return res.json({ leads: [], message: 'No results found — try a broader niche or different location' })

    // Save leads to session
    const memory = await loadSession(sessionId)
    memory.leads = leads
    memory.facts.push(`Looking for ${niche} leads in ${location}`)
    await saveSession(sessionId, memory)

    // Let Robin comment on the leads
    const summary = await ai.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: `You are Robin. Found ${leads.length} ${niche} businesses in ${location}. Best targets are those with 3-4 star ratings (room to improve reviews) or low review counts (easy to help). Pick the top 3 targets and say why in 2 sentences. End with 🦊\n\nLeads: ${JSON.stringify(leads.slice(0, 5))}` }]
    })

    res.json({ leads, robin_take: summary.content[0].text })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Task complete ─────────────────────────────────────────────────────────
app.post('/task-done', async (req, res) => {
  const { sessionId = 'web-default', description, amount = 0 } = req.body
  const reply = await think(sessionId, `I just completed: ${description}${amount ? `. I earned £${amount}.` : ''}`)
  const memory = await loadSession(sessionId)
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
  await saveProfile(sessionId, sourceType, data, analysis.content[0].text)
  res.json({ ok: true, tags: analysis.content[0].text })
})
app.delete('/profile', async (req, res) => {
  const { sessionId = 'web-default' } = req.body
  await deleteProfile(sessionId)
  res.json({ ok: true })
})

// ── GDPR ──────────────────────────────────────────────────────────────────
app.get('/my-data/:sessionId', async (req, res) => {
  const sid = req.params.sessionId
  const data = await exportUserData(sid)
  res.json(data)
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
    const memory = await loadSession(sessionId)
    memory.facts.push(`Business idea analysed: ${idea}`)
    await saveSession(sessionId, memory)

    send('done', 'Analysis complete')
    res.end()
  } catch (err) {
    send('error', 'Analysis failed — ' + err.message)
    res.end()
  }
})

app.delete('/clear-memory', async (req, res) => {
  const { sessionId = 'web-default' } = req.body
  await clearMemory(sessionId)
  res.json({ ok: true })
})
app.delete('/delete-account', async (req, res) => {
  const { sessionId } = req.body
  await deleteAccount(sessionId)
  res.json({ ok: true })
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

// ── Action feed ───────────────────────────────────────────────────────────
app.get('/actions/:sessionId', async (req, res) => {
  try {
    const session = await loadSession(req.params.sessionId)
    const actions = (session.pending_actions || [])
      .slice(-20)
      .reverse()
      .map(a => ({
        id:         a.id,
        type:       a.type,
        title:      a.type === 'draft_email'  ? `Reply to ${a.to}` :
                    a.type === 'send_message' ? `Message to ${a.recipient}` :
                    a.title || 'Action ready',
        body:       a.body || a.draft || '',
        to:         a.to || a.recipient || '',
        subject:    a.subject || '',
        risk:       a.risk || 'medium',
        created_at: a.created_at
      }))
    res.json({ actions, count: actions.length })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/actions/:actionId/approve', async (req, res) => {
  const { sessionId, approved } = req.body
  if (!sessionId) return res.status(400).json({ error: 'No sessionId' })
  try {
    const session = await loadSession(sessionId)
    const action  = (session.pending_actions || []).find(a => a.id === req.params.actionId)
    if (!action) return res.status(404).json({ error: 'Action not found' })

    if (approved && action.type === 'draft_email') {
      const tokens = await getEmailTokens(sessionId)
      if (tokens) await sendEmail(tokens, { to: action.to, subject: action.subject, body: action.body })
    }

    session.pending_actions = (session.pending_actions || []).filter(a => a.id !== req.params.actionId)
    if (session.pending_action?.id === req.params.actionId) session.pending_action = null
    await saveSession(sessionId, session)

    res.json({ ok: true, approved })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ── Gmail OAuth ───────────────────────────────────────────────────────────
async function getEmailTokens(sessionId) {
  const user = await loadUser(sessionId)
  return user?.gmail_tokens || null
}

app.get('/email/auth', (req, res) => {
  const { sessionId = 'web-default' } = req.query
  const url = getAuthUrl() + `&state=${encodeURIComponent(sessionId)}`
  res.redirect(url)
})

app.get('/email/callback', async (req, res) => {
  const { code, state: sessionId } = req.query
  if (!code) return res.status(400).send('No code')
  try {
    const tokens  = await exchangeCode(code)
    const user    = (await loadUser(sessionId)) || {}
    user.gmail_tokens = tokens
    await saveUser(sessionId, user)

    // Get Gmail profile to confirm
    const profile = await getEmailProfile(tokens)
    user.gmail_email = profile.email
    await saveUser(sessionId, user)

    // Store first email ID baseline for new-email polling
    const latestId = await getLatestId(tokens)
    const session  = await loadSession(sessionId)
    session.gmail_last_id = latestId
    await saveSession(sessionId, session)

    res.send(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#fff">
      <div style="font-size:48px">🦊</div>
      <h2 style="color:#111">Gmail connected!</h2>
      <p style="color:#555">Robin can now read and manage your emails.</p>
      <p style="color:#E8722A;font-size:14px">${profile.email}</p>
      <script>setTimeout(()=>window.close(),2000)</script>
    </body></html>`)
  } catch (err) {
    res.status(500).send('Auth failed: ' + err.message)
  }
})

app.get('/email/status', async (req, res) => {
  const { sessionId = 'web-default' } = req.query
  const user = await loadUser(sessionId)
  res.json({ connected: !!user?.gmail_tokens, email: user?.gmail_email || null })
})

app.delete('/email/disconnect', async (req, res) => {
  const { sessionId = 'web-default' } = req.body
  const user = await loadUser(sessionId)
  if (user) { delete user.gmail_tokens; delete user.gmail_email; await saveUser(sessionId, user) }
  res.json({ ok: true })
})

// ── New email polling (every 90s) ─────────────────────────────────────────
const emailNotifications = new Map() // sessionId → { message, at }

async function pollNewEmails() {
  if (!process.env.GMAIL_CLIENT_ID) return
  // This is lightweight — only checks if there's a new message ID, no full read
  // In production you'd iterate all active sessions from Redis
  // For now it checks the web-default session
  try {
    const user = await loadUser('web-default')
    if (!user?.gmail_tokens) return
    const session   = await loadSession('web-default')
    const lastId    = session.gmail_last_id
    const latestId  = await getLatestId(user.gmail_tokens)
    if (latestId && latestId !== lastId) {
      // Fetch the new email details
      const emails = await listEmails(user.gmail_tokens, { maxResults: 1, unreadOnly: false })
      if (emails.length) {
        const e = emails[0]
        const from    = e.from.replace(/<.*>/, '').trim()
        const subject = e.subject || '(no subject)'
        emailNotifications.set('web-default', {
          message: `📬 New email from **${from}** — "${subject}" 🦊`,
          at: new Date().toISOString()
        })
        session.gmail_last_id = latestId
        await saveSession('web-default', session)
      }
    }
  } catch {}
}

setInterval(pollNewEmails, 90_000)

// ── Email notification check (called by /pulse or /chat) ──────────────────
app.get('/email/notifications', (req, res) => {
  const { sessionId = 'web-default' } = req.query
  const note = emailNotifications.get(sessionId)
  if (note) {
    emailNotifications.delete(sessionId)
    return res.json({ notification: note.message })
  }
  res.json({ notification: null })
})

// ── WhatsApp webhook ──────────────────────────────────────────────────────
app.post('/whatsapp/incoming', async (req, res) => {
  try {
    const from = req.body.From
    const body = req.body.Body?.trim()
    if (!from || !body) return res.set('Content-Type', 'text/xml').send('<Response></Response>')
    const sessionId = from.replace('whatsapp:', '').replace(/\D/g, '')
    const reply = await think(sessionId, body)
    const { twiml: { MessagingResponse } } = await import('twilio')
    const twiml = new MessagingResponse()
    twiml.message(reply)
    res.set('Content-Type', 'text/xml').send(twiml.toString())
  } catch (err) {
    console.error('[WhatsApp]', err.message)
    const { twiml: { MessagingResponse } } = await import('twilio')
    const twiml = new MessagingResponse()
    twiml.message("Robin's having a moment — try again in a sec 🦊")
    res.set('Content-Type', 'text/xml').send(twiml.toString())
  }
})

app.listen(PORT, () => console.log(`\n🦊 Robin running at http://localhost:${PORT}\n`))
