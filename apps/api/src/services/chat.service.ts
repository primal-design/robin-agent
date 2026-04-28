import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import { loadSession, saveSession, db, type Session } from '../db/client.js'
import { buildUserContext, handleApproval } from '../brain/brain.js'
import { buildSystemPrompt, rejectionContext, type RobinToneMode } from '../brain/prompts.js'
import { doResearch, doTrendAnalysis, redditSearch, hackerNewsSearch } from '../brain/planner.js'
import { listEmails, getEmailBody, sendEmail } from '../lib/gmail.js'

let _ai: Anthropic | null = null
function ai() { return _ai || (_ai = new Anthropic({ apiKey: env.anthropicKey })) }

function detectSignals(recentText: string) {
  return {
    money_stress:   /rent|broke|need money|can't afford|bills|skint|struggling|debt|income/.test(recentText),
    skill_mention:  /i can|i'm good at|i used to|people ask me|i know how to|my background/.test(recentText),
    time_available: /evenings|only work|spare time|free most|been slow|3 days/.test(recentText),
    task_avoidance: /later|not sure|too many|overwhelmed|don't know where|too much|avoid|avoiding|procrastinat/.test(recentText),
    frustration:    /tired of|stuck|bored|hate my job|going nowhere|need a change|fed up|exhausted|burnt out/.test(recentText),
    ambition:       /want to|thinking about|dream of|i'd love to|what if|build|start|launch/.test(recentText),
    doubt:          /can't|cannot|impossible|not ready|not good enough|who would pay|no one will/.test(recentText),
  }
}

function detectToneMode(signals: Record<string, boolean>, rejectionRound = 0): RobinToneMode {
  if (rejectionRound >= 2) return 'push'
  if (signals.money_stress || signals.frustration || signals.doubt) return 'support'
  if (signals.task_avoidance) return 'push'
  if (signals.ambition || signals.time_available) return 'focus'
  return 'normal'
}

function updateRelationshipMemory(memory: Session, userMessage: string, signals: Record<string, boolean>) {
  const relationship = ((memory as any).relationship_memory ||= {
    recurring_patterns: [],
    friction_points: [],
    working_style: [],
    wins: [],
    voice_notes: [],
    last_updated: null,
  })

  const addUnique = (key: string, value: string) => {
    const list = relationship[key] || []
    if (!list.includes(value)) list.push(value)
    relationship[key] = list.slice(-8)
  }

  const text = userMessage.toLowerCase()
  if (signals.task_avoidance) addUnique('recurring_patterns', 'User tends to get stuck when there are too many open loops.')
  if (signals.frustration) addUnique('friction_points', 'Frustration rises when progress feels unclear or slow.')
  if (signals.doubt) addUnique('friction_points', 'Self-doubt shows up around whether the offer is good enough or whether people will pay.')
  if (signals.ambition) addUnique('working_style', 'User responds to direct momentum and concrete next steps.')
  if (/draft|write|message|email|send/i.test(userMessage)) addUnique('working_style', 'User benefits when Robin drafts usable text instead of explaining theory.')
  if (/done|finished|sent|completed|made|earned|closed/i.test(text)) addUnique('wins', `Recent win: ${userMessage.slice(0, 140)}`)
  if (/too much|overwhelmed|busy/i.test(text)) addUnique('voice_notes', 'When overwhelmed, keep Robin very short and reduce pressure.')
  if (/be direct|straight|no fluff/i.test(text)) addUnique('voice_notes', 'User explicitly prefers direct, no-fluff guidance.')

  relationship.last_updated = new Date().toISOString()
}

function relationshipCallback(memory: Session): string {
  const rel = (memory as any).relationship_memory
  if (!rel) return 'No long-term relationship memory yet.'

  const parts: string[] = []
  if (rel.recurring_patterns?.length) parts.push(`Recurring patterns:\n- ${rel.recurring_patterns.slice(-4).join('\n- ')}`)
  if (rel.friction_points?.length) parts.push(`Friction points:\n- ${rel.friction_points.slice(-4).join('\n- ')}`)
  if (rel.working_style?.length) parts.push(`Working style:\n- ${rel.working_style.slice(-4).join('\n- ')}`)
  if (rel.wins?.length) parts.push(`Recent wins:\n- ${rel.wins.slice(-3).join('\n- ')}`)
  if (rel.voice_notes?.length) parts.push(`How to speak to this user:\n- ${rel.voice_notes.slice(-4).join('\n- ')}`)

  return parts.length ? parts.join('\n') : 'No strong relationship memory yet.'
}

function humanCallback(memory: Session): string {
  const facts = (memory.facts || []).filter(Boolean).slice(-5)
  const milestones = ((memory.milestones || []) as any[]).slice(-3)
  const lastFact = facts[facts.length - 1]
  const lastMilestone = milestones[milestones.length - 1]
  const bits: string[] = []

  if (lastFact) bits.push(`Recent remembered detail: ${lastFact}`)
  if (lastMilestone?.milestone) bits.push(`Recent milestone: ${lastMilestone.milestone}`)
  if (memory.pending_action) bits.push('There is an unfinished pending action. Prefer closing that loop before opening a new one.')
  if ((memory.tasks_done || 0) > 0) bits.push(`User has completed ${memory.tasks_done} task(s). Mention progress only if useful, not every time.`)
  const silenceHours = Number(memory.silence_hours) || 0
  if (silenceHours > 24) bits.push(`User has been away for about ${Math.round(silenceHours)} hours. Re-enter gently, not with guilt.`)

  return bits.length ? bits.join('\n') : 'No strong memory callback yet. Build one by noticing what matters.'
}

function firstRunReply(memory: Session): string | null {
  const assistantCount = memory.messages.filter((m: any) => m.role === 'assistant').length
  const userCount = memory.messages.filter((m: any) => m.role === 'user').length
  if (assistantCount > 0 || userCount > 1) return null
  return `Hey — I’m Robin.\n\nI’ll keep this simple.\n\nWhat’s one thing that’s been slowing you down lately?`
}

async function fetchUrlContext(message: string): Promise<string> {
  const urlMatch = message?.match(/https?:\/\/[^\s]+/)
  if (!urlMatch) return ''
  try {
    const res  = await fetch(urlMatch[0], { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) })
    const html = await res.text()
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000)
    return `\nURL content from ${urlMatch[0]}:\n${text}`
  } catch {
    return `\nUser sent a URL (${urlMatch[0]}) but I could not fetch it.`
  }
}

async function handleTool(name: string, input: Record<string, unknown>, id: string, memory: Session) {
  if (name === 'remember_fact') {
    memory.facts.push(String(input.fact))
    return { type: 'tool_result' as const, tool_use_id: id, content: `Saved: ${input.fact}` }
  }
  if (name === 'update_milestone') {
    memory.milestones = memory.milestones || []
    ;(memory.milestones as unknown[]).push({ milestone: input.milestone, done: true, at: new Date().toISOString() })
    if (input.earned) memory.total_earned = (memory.total_earned || 0) + Number(input.earned)
    return { type: 'tool_result' as const, tool_use_id: id, content: `Milestone logged: ${input.milestone}` }
  }
  if (name === 'generate_plan') {
    memory.facts.push(`Goal: ${input.goal}`, `Niche: ${input.niche}`)
    memory.rejection_round = 0
    return { type: 'tool_result' as const, tool_use_id: id, content: `21-DAY PLAN\nGoal: ${input.goal}\nNiche: ${input.niche}\nTime: ${input.timePerDay} mins/day\n\nWEEK 1: Define offer → find 10 targets → write outreach → send to 5 people\nWEEK 2: Follow up → handle replies → book calls\nWEEK 3: Run calls → send proposals → close first ${input.goal}\n\nSTART TODAY: Write your offer in one sentence.` }
  }
  if (name === 'draft_content') {
    memory.pending_actions = memory.pending_actions || []
    const action = { id: `act_${Date.now()}`, type: 'send_message', draft: input.content, recipient: input.recipient || 'your contact', content_type: input.type, risk: 'medium' }
    ;(memory.pending_actions as unknown[]).push(action)
    memory.pending_action = action
    return { type: 'tool_result' as const, tool_use_id: id, content: `DRAFT READY (needs approval):\n\n${input.content}\n\nAsk user: "Want me to send this?"` }
  }
  if (name === 'research') {
    const findings = await doResearch(String(input.type), String(input.query), String(input.context || ''))
    return { type: 'tool_result' as const, tool_use_id: id, content: findings }
  }

  if (name === 'trend_analysis') {
    const findings = await doTrendAnalysis(String(input.topic), String(input.context || ''))
    return { type: 'tool_result' as const, tool_use_id: id, content: findings }
  }

  if (name === 'reddit_search') {
    const results = await redditSearch(String(input.query), String(input.subreddit || ''))
    if (!results) return { type: 'tool_result' as const, tool_use_id: id, content: 'No Reddit results found.' }
    return { type: 'tool_result' as const, tool_use_id: id, content: results }
  }

  if (name === 'hackernews_search') {
    const results = await hackerNewsSearch(String(input.query))
    if (!results) return { type: 'tool_result' as const, tool_use_id: id, content: 'No HackerNews results found.' }
    return { type: 'tool_result' as const, tool_use_id: id, content: results }
  }
  if (name === 'log_task_done') {
    memory.tasks_done   = (memory.tasks_done || 0) + 1
    memory.total_earned = (memory.total_earned || 0) + (Number(input.amount_earned) || 0)
    memory.streak       = (memory.streak || 0) + 1
    const totalEarned = Number(memory.total_earned) || 0
    const amountEarned = Number(input.amount_earned) || 0
    const hit100 = totalEarned >= 100 && (totalEarned - amountEarned) < 100
    return { type: 'tool_result' as const, tool_use_id: id, content: hit100 ? `MILESTONE: First £100 hit. Streak: ${memory.streak}. Total: £${memory.total_earned}. Help user mark the win without overhyping it.` : `Task logged. Streak: ${memory.streak} days. Total: £${memory.total_earned}.` }
  }
  if (name === 'find_leads') {
    if (!env.googleMapsKey) return { type: 'tool_result' as const, tool_use_id: id, content: 'Google Maps not configured.' }
    try {
      const query = encodeURIComponent(`${input.niche} in ${input.location}`)
      const res   = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${env.googleMapsKey}`)
      const data  = await res.json() as { results: { name: string; formatted_address: string; rating?: number; user_ratings_total?: number }[] }
      const leads = (data.results || []).slice(0, 10)
      memory.leads = leads
      const formatted = leads.map((l, i) => `${i+1}. ${l.name} — ${l.formatted_address} | rating ${l.rating || 'no rating'} (${l.user_ratings_total || 0} reviews)`).join('\n')
      return { type: 'tool_result' as const, tool_use_id: id, content: `Found ${leads.length} ${input.niche} businesses in ${input.location}:\n${formatted}\n\nBest targets: 3-4 stars or few reviews.` }
    } catch {
      return { type: 'tool_result' as const, tool_use_id: id, content: 'Could not fetch leads right now.' }
    }
  }
  if (name === 'read_emails' || name === 'get_email_body' || name === 'send_email') {
    const tokRow = await db.query(`SELECT access_token, refresh_token, expiry_date FROM gmail_tokens WHERE user_id=$1`, [memory.userId])
    if (!tokRow.rows.length) return { type: 'tool_result' as const, tool_use_id: id, content: `Gmail not connected. Ask the user to connect Gmail by visiting: https://robin-agent.onrender.com/email/connect?phone=THEIR_PHONE` }
    const tokens = { access_token: tokRow.rows[0].access_token, refresh_token: tokRow.rows[0].refresh_token, expiry_date: tokRow.rows[0].expiry_date }
    if (name === 'read_emails') {
      const emails = await listEmails(tokens, { query: input.query as string, maxResults: input.maxResults as number || 10, unreadOnly: input.unreadOnly as boolean })
      if (!emails.length) return { type: 'tool_result' as const, tool_use_id: id, content: 'No emails found.' }
      const summary = emails.map((e: any) => `[${e.id}] ${e.unread ? 'unread' : 'read'} From: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nPreview: ${e.snippet}`).join('\n\n')
      return { type: 'tool_result' as const, tool_use_id: id, content: summary }
    }
    if (name === 'get_email_body') {
      const body = await getEmailBody(tokens, input.messageId as string)
      return { type: 'tool_result' as const, tool_use_id: id, content: body || 'Empty email.' }
    }
    if (name === 'send_email') {
      await sendEmail(tokens, { to: input.to as string, subject: input.subject as string, body: input.body as string, threadId: input.threadId as string })
      return { type: 'tool_result' as const, tool_use_id: id, content: `Email sent to ${input.to}` }
    }
  }
  return { type: 'tool_result' as const, tool_use_id: id, content: 'Unknown tool.' }
}

export async function chatService(userId: string, userMessage: string): Promise<string> {
  const memory = await loadSession(userId)
  memory.userId = userId
  if (userMessage) memory.messages.push({ role: 'user', content: userMessage })

  const opener = firstRunReply(memory)
  if (opener) {
    memory.messages.push({ role: 'assistant', content: opener })
    await saveSession(userId, memory)
    return opener
  }

  const recentText = memory.messages.slice(-10).filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '').join(' ').toLowerCase()
  const signals    = detectSignals(recentText)
  if (userMessage) updateRelationshipMemory(memory, userMessage, signals)

  const ctx        = buildUserContext(memory)
  const rejectCtx  = rejectionContext(memory.rejection_round || 0)
  const urlContext = userMessage ? await fetchUrlContext(userMessage) : ''
  const toneMode   = detectToneMode(signals, memory.rejection_round || 0)
  const callback   = `${humanCallback(memory)}\n\nLONG-TERM RELATIONSHIP MEMORY:\n${relationshipCallback(memory)}`
  const onboarding = !memory.onboarding_completed && memory.messages.filter((m: any) => m.role === 'assistant').length < 4

  const approvalSignals = ['yes', 'do it', 'go ahead', 'send it', 'go for it', 'approved', 'yep', 'yeah do it']
  const isApproval = userMessage && approvalSignals.some(s => userMessage.toLowerCase().includes(s))
  if (isApproval && memory.pending_action) {
    const result = await handleApproval(memory.pending_action as Record<string, unknown>, memory)
    memory.pending_action = null
    memory.messages.push({ role: 'assistant', content: result.followup })
    await saveSession(userId, memory)
    return result.followup
  }

  const systemPrompt = buildSystemPrompt({ ctx, signals, rejectCtx, skillContext: `HUMAN CALLBACKS:\n${callback}`, urlContext, toneMode, onboarding })
  const msgCount     = memory.messages.filter((m: { role: string }) => m.role === 'assistant').length
  const model        = msgCount < 3 ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'

  const response = await ai().messages.create({
    model, max_tokens: 900, system: systemPrompt,
    tools: [
      { name: 'remember_fact',    description: 'Remember a specific, durable fact that will help future conversations feel personal', input_schema: { type: 'object' as const, properties: { fact: { type: 'string' } }, required: ['fact'] } },
      { name: 'update_milestone', description: 'Mark a milestone as complete',                input_schema: { type: 'object' as const, properties: { milestone: { type: 'string' }, earned: { type: 'number' } }, required: ['milestone'] } },
      { name: 'generate_plan',    description: 'Build a 21-day action plan',                  input_schema: { type: 'object' as const, properties: { goal: { type: 'string' }, niche: { type: 'string' }, timePerDay: { type: 'number' } }, required: ['goal', 'niche', 'timePerDay'] } },
      { name: 'draft_content',    description: 'Draft outreach or posts for user approval',   input_schema: { type: 'object' as const, properties: { type: { type: 'string' }, recipient: { type: 'string' }, content: { type: 'string' } }, required: ['type', 'content'] } },
      { name: 'research',         description: 'Research a person, market, topic, or trend',  input_schema: { type: 'object' as const, properties: { type: { type: 'string' }, query: { type: 'string' }, context: { type: 'string' } }, required: ['type', 'query'] } },
      { name: 'trend_analysis',   description: 'Analyse what people are searching, posting, and struggling with on a topic — uses Reddit + web data for real behaviour insights', input_schema: { type: 'object' as const, properties: { topic: { type: 'string' }, context: { type: 'string' } }, required: ['topic'] } },
      { name: 'reddit_search',      description: 'Search Reddit for real conversations about a topic or in a specific subreddit', input_schema: { type: 'object' as const, properties: { query: { type: 'string' }, subreddit: { type: 'string' } }, required: ['query'] } },
      { name: 'hackernews_search',  description: 'Search HackerNews for tech and startup discussions, trends, and signals', input_schema: { type: 'object' as const, properties: { query: { type: 'string' } }, required: ['query'] } },
      { name: 'log_task_done',    description: 'Log a completed task, update streak',          input_schema: { type: 'object' as const, properties: { task_description: { type: 'string' }, amount_earned: { type: 'number' } }, required: ['task_description'] } },
      { name: 'find_leads',       description: 'Find local business leads via Google Maps',   input_schema: { type: 'object' as const, properties: { niche: { type: 'string' }, location: { type: 'string' } }, required: ['niche', 'location'] } },
      { name: 'read_emails',      description: 'Read emails from the user Gmail inbox',        input_schema: { type: 'object' as const, properties: { query: { type: 'string' }, maxResults: { type: 'number' }, unreadOnly: { type: 'boolean' } }, required: [] } },
      { name: 'get_email_body',   description: 'Get the full body of a specific email by ID',  input_schema: { type: 'object' as const, properties: { messageId: { type: 'string' } }, required: ['messageId'] } },
      { name: 'send_email',       description: 'Send an email on behalf of the user',          input_schema: { type: 'object' as const, properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, threadId: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
    ],
    messages: memory.messages.slice(-20) as Anthropic.MessageParam[],
  })

  if (response.stop_reason === 'tool_use') {
    const results = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      const result = await handleTool(block.name, block.input as Record<string, unknown>, block.id, memory)
      results.push(result)
    }
    memory.messages.push({ role: 'assistant', content: response.content })
    memory.messages.push({ role: 'user',      content: results })
    await saveSession(userId, memory)
    return chatService(userId, '')
  }

  const reply = response.content[0].type === 'text' ? response.content[0].text : ''
  memory.messages.push({ role: 'assistant', content: reply })
  if (onboarding && memory.messages.filter((m: any) => m.role === 'assistant').length >= 3) memory.onboarding_completed = true
  await saveSession(userId, memory)
  return reply
}
