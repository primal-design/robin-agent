import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'
import { loadSession, saveSession, db, type Session } from '../db/client.js'
import { buildUserContext, handleApproval } from '../brain/brain.js'
import { buildSystemPrompt, rejectionContext } from '../brain/prompts.js'
import { doResearch } from '../brain/planner.js'
import { listEmails, getEmailBody, sendEmail } from '../lib/gmail.js'

let _ai: Anthropic | null = null
function ai() { return _ai || (_ai = new Anthropic({ apiKey: env.anthropicKey })) }

// ── Signal detection ──────────────────────────────────────────────────────
function detectSignals(recentText: string) {
  return {
    money_stress:   /rent|broke|need money|can't afford|bills|skint|struggling|debt|income/.test(recentText),
    skill_mention:  /i can|i'm good at|i used to|people ask me|i know how to|my background/.test(recentText),
    time_available: /evenings|only work|spare time|free most|been slow|3 days/.test(recentText),
    task_avoidance: /later|not sure|too many|overwhelmed|don't know where|too much/.test(recentText),
    frustration:    /tired of|stuck|bored|hate my job|going nowhere|need a change/.test(recentText),
    ambition:       /want to|thinking about|dream of|i'd love to|what if/.test(recentText),
  }
}

// ── URL fetcher ───────────────────────────────────────────────────────────
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

// ── Tool handler ──────────────────────────────────────────────────────────
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

  if (name === 'log_task_done') {
    memory.tasks_done   = (memory.tasks_done || 0) + 1
    memory.total_earned = (memory.total_earned || 0) + (Number(input.amount_earned) || 0)
    memory.streak       = (memory.streak || 0) + 1
    const hit100 = memory.total_earned >= 100 && (memory.total_earned - (Number(input.amount_earned) || 0)) < 100
    return { type: 'tool_result' as const, tool_use_id: id, content: hit100 ? `MILESTONE: First £100 hit! Streak: ${memory.streak}. Total: £${memory.total_earned}. Write the win post.` : `Task logged. Streak: ${memory.streak} days. Total: £${memory.total_earned}.` }
  }

  if (name === 'find_leads') {
    if (!env.googleMapsKey) return { type: 'tool_result' as const, tool_use_id: id, content: 'Google Maps not configured.' }
    try {
      const query = encodeURIComponent(`${input.niche} in ${input.location}`)
      const res   = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${env.googleMapsKey}`)
      const data  = await res.json() as { results: { name: string; formatted_address: string; rating?: number; user_ratings_total?: number }[] }
      const leads = (data.results || []).slice(0, 10)
      memory.leads = leads
      const formatted = leads.map((l, i) => `${i+1}. ${l.name} — ${l.formatted_address} | ⭐ ${l.rating || 'no rating'} (${l.user_ratings_total || 0} reviews)`).join('\n')
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
      const summary = emails.map((e: any) => `[${e.id}] ${e.unread ? '🔴' : '⚪'} From: ${e.from}\nSubject: ${e.subject}\nDate: ${e.date}\nPreview: ${e.snippet}`).join('\n\n')
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

// ── Main chat service ─────────────────────────────────────────────────────
export async function chatService(userId: string, userMessage: string): Promise<string> {
  const memory = await loadSession(userId)
  memory.userId = userId

  if (userMessage) memory.messages.push({ role: 'user', content: userMessage })

  const ctx        = buildUserContext(memory)
  const rejectCtx  = rejectionContext(memory.rejection_round || 0)
  const urlContext = userMessage ? await fetchUrlContext(userMessage) : ''
  const recentText = memory.messages.slice(-10).filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '').join(' ').toLowerCase()
  const signals    = detectSignals(recentText)

  // Approval detection
  const approvalSignals = ['yes', 'do it', 'go ahead', 'send it', 'go for it', 'approved', 'yep', 'yeah do it']
  const isApproval = userMessage && approvalSignals.some(s => userMessage.toLowerCase().includes(s))
  if (isApproval && memory.pending_action) {
    const result = await handleApproval(memory.pending_action as Record<string, unknown>, memory)
    memory.pending_action = null
    memory.messages.push({ role: 'assistant', content: result.followup })
    await saveSession(userId, memory)
    return result.followup
  }

  const systemPrompt = buildSystemPrompt({ ctx, signals, rejectCtx, skillContext: '', urlContext })
  const msgCount     = memory.messages.filter((m: { role: string }) => m.role === 'assistant').length
  const model        = msgCount < 3 ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'

  const response = await ai().messages.create({
    model, max_tokens: 1000, system: systemPrompt,
    tools: [
      { name: 'remember_fact',    description: 'Remember a fact about the user',             input_schema: { type: 'object' as const, properties: { fact: { type: 'string' } }, required: ['fact'] } },
      { name: 'update_milestone', description: 'Mark a milestone as complete',                input_schema: { type: 'object' as const, properties: { milestone: { type: 'string' }, earned: { type: 'number' } }, required: ['milestone'] } },
      { name: 'generate_plan',    description: 'Build a 21-day action plan',                  input_schema: { type: 'object' as const, properties: { goal: { type: 'string' }, niche: { type: 'string' }, timePerDay: { type: 'number' } }, required: ['goal', 'niche', 'timePerDay'] } },
      { name: 'draft_content',    description: 'Draft outreach or posts for user approval',   input_schema: { type: 'object' as const, properties: { type: { type: 'string' }, recipient: { type: 'string' }, content: { type: 'string' } }, required: ['type', 'content'] } },
      { name: 'research',         description: 'Research a person, market, topic, or trend',  input_schema: { type: 'object' as const, properties: { type: { type: 'string' }, query: { type: 'string' }, context: { type: 'string' } }, required: ['type', 'query'] } },
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
  await saveSession(userId, memory)
  return reply
}
