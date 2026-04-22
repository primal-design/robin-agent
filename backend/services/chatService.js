/**
 * Chat service — Robin brain invocation
 * Extracted from the monolithic think() in server.js
 */

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import matter from 'gray-matter'
import { loadSession, saveSession, loadProfile } from '../lib/db.js'
import { buildUserContext, handleApproval, PERMISSIONS } from '../brain/brain.js'
import { buildSystemPrompt, rejectionContext } from '../brain/prompts.js'
import { doResearch } from '../brain/planner.js'
import { getGmailTokens } from '../models/user.js'
import { buildAction, addAction, removeAction } from '../models/action.js'
import {
  listEmails, sendEmail, archiveEmails, findContact
} from '../lib/gmail.js'

const __dir = dirname(fileURLToPath(import.meta.url))
let _ai = null
function ai() { return _ai || (_ai = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })) }

// ── Skills loader ─────────────────────────────────────────────────────────
function loadSkills() {
  const skillsDir = join(__dir, '../../skills')
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

// ── URL fetcher ───────────────────────────────────────────────────────────
async function fetchUrlContext(message) {
  const urlMatch = message?.match(/https?:\/\/[^\s]+/)
  if (!urlMatch) return ''
  try {
    const pageRes = await fetch(urlMatch[0], { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) })
    const html    = await pageRes.text()
    const text    = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 3000)
    return `\nURL content from ${urlMatch[0]}:\n${text}`
  } catch {
    return `\nUser sent a URL (${urlMatch[0]}) but I could not fetch it — do NOT pretend I read it. Tell the user I can't open that link and ask them to paste the key info directly.`
  }
}

// ── Signal detection (inline, matching server.js) ─────────────────────────
function detectInlineSignals(recentText) {
  return {
    money_stress:   /rent|broke|need money|can't afford|bills|skint|struggling|debt|income/.test(recentText),
    skill_mention:  /i can|i'm good at|i used to|people ask me|i know how to|my background/.test(recentText),
    time_available: /evenings|only work|spare time|free most|been slow|3 days/.test(recentText),
    task_avoidance: /later|not sure|too many|overwhelmed|don't know where|too much/.test(recentText),
    frustration:    /tired of|stuck|bored|hate my job|going nowhere|need a change/.test(recentText),
    ambition:       /want to|thinking about|dream of|i'd love to|what if/.test(recentText),
  }
}

// ── Main chat service ─────────────────────────────────────────────────────
export async function chatService(sessionId, userMessage, options = {}) {
  const memory  = await loadSession(sessionId)
  const profile = await loadProfile(sessionId)

  if (userMessage) memory.messages.push({ role: 'user', content: userMessage })

  const ctx          = buildUserContext(memory, profile)
  const skillContext = userMessage ? getRelevantSkills(userMessage) : ''
  const rejectCtx    = rejectionContext(memory.rejection_round || 0)
  const urlContext   = userMessage ? await fetchUrlContext(userMessage) : ''

  const msgCount = memory.messages.filter(m => m.role === 'assistant').length
  const model    = msgCount < 3 ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001'

  // Approval detection
  const approvalSignals = ['yes', 'do it', 'go ahead', 'send it', 'go for it', 'approved', 'yep', 'yeah do it']
  const isApproval = userMessage && approvalSignals.some(s => userMessage.toLowerCase().includes(s))
  if (isApproval && memory.pending_action) {
    const result = await handleApproval(sessionId, memory.pending_action, memory)
    const doneId = memory.pending_action.id
    memory.pending_action = null
    memory.pending_actions = (memory.pending_actions || []).filter(a => a.id !== doneId)
    memory.messages.push({ role: 'assistant', content: result.followup })
    await saveSession(sessionId, memory)
    return result.followup
  }

  const recentText = memory.messages.slice(-10).filter(m => m.role === 'user').map(m => typeof m.content === 'string' ? m.content : '').join(' ').toLowerCase()
  const signals    = detectInlineSignals(recentText)
  const systemPrompt = buildSystemPrompt({ ctx, signals, rejectCtx, skillContext, urlContext })

  const response = await ai().messages.create({
    model,
    max_tokens: 1000,
    system: systemPrompt,
    tools: [
      { name: 'remember_fact',    description: 'Remember a fact about the user',                    input_schema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
      { name: 'update_milestone', description: 'Mark a milestone as complete',                       input_schema: { type: 'object', properties: { milestone: { type: 'string' }, earned: { type: 'number' } }, required: ['milestone'] } },
      { name: 'generate_plan',    description: 'Build a 21-day action plan',                         input_schema: { type: 'object', properties: { goal: { type: 'string' }, niche: { type: 'string' }, timePerDay: { type: 'number' } }, required: ['goal', 'niche', 'timePerDay'] } },
      { name: 'draft_content',    description: 'Draft outreach, posts, or messages for user approval', input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['outreach', 'social_post', 'email'] }, recipient: { type: 'string' }, content: { type: 'string' } }, required: ['type', 'content'] } },
      { name: 'research',         description: 'Research a person, market, topic, competitor, or trend. AUTO-EXECUTES.', input_schema: { type: 'object', properties: { type: { type: 'string', enum: ['person', 'market', 'topic', 'competitor', 'trend'] }, query: { type: 'string' }, context: { type: 'string' } }, required: ['type', 'query'] } },
      { name: 'log_task_done',    description: 'User completed a task. Log it, update streak.',      input_schema: { type: 'object', properties: { task_description: { type: 'string' }, amount_earned: { type: 'number' } }, required: ['task_description'] } },
      { name: 'find_leads',       description: 'Find local business leads using Google Maps.',        input_schema: { type: 'object', properties: { niche: { type: 'string' }, location: { type: 'string' } }, required: ['niche', 'location'] } },
      { name: 'read_emails',      description: 'Read emails from the user\'s Gmail inbox.',           input_schema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number' }, unreadOnly: { type: 'boolean' } }, required: [] } },
      { name: 'draft_email',      description: 'Draft an email for user approval before sending.',    input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, find_contact: { type: 'string' } }, required: ['subject', 'body'] } },
      { name: 'send_email',       description: 'Send a previously approved email draft.',             input_schema: { type: 'object', properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' }, threadId: { type: 'string' } }, required: ['to', 'subject', 'body'] } },
      { name: 'clean_inbox',      description: 'Archive emails to clean the inbox.',                  input_schema: { type: 'object', properties: { query: { type: 'string' }, maxResults: { type: 'number' } }, required: ['query'] } },
      { name: 'email_summary',    description: 'Summarise all emails from today or this week.',       input_schema: { type: 'object', properties: { period: { type: 'string', enum: ['today', 'week'] } }, required: ['period'] } },
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
        results.push({ type: 'tool_result', tool_use_id: id, content: `21-DAY PLAN\nGoal: ${input.goal}\nNiche: ${input.niche}\nTime: ${input.timePerDay} mins/day\n\nWEEK 1: Define offer → find 10 targets → write outreach → send to 5 people\nWEEK 2: Follow up → handle replies → book calls\nWEEK 3: Run calls → send proposals → close first ${input.goal}\n\nSTART TODAY: Write your offer in one sentence.` })
      }

      if (name === 'draft_content') {
        memory.pending_actions = memory.pending_actions || []
        const action = buildAction('send_message', { draft: input.content, recipient: input.recipient || 'your contact', content_type: input.type, risk: 'medium' })
        memory.pending_actions.push(action)
        memory.pending_action = action
        results.push({ type: 'tool_result', tool_use_id: id, content: `DRAFT READY (needs approval):\n\n${input.content}\n\nAsk user: "Want me to send this?"` })
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
        results.push({ type: 'tool_result', tool_use_id: id, content: hit100 ? `MILESTONE: First £100 hit! Streak: ${memory.streak}. Total: £${memory.total_earned}. Write the win post.` : `Task logged. Streak: ${memory.streak} days. Total: £${memory.total_earned}.` })
      }

      if (name === 'find_leads') {
        const { findLocalLeads } = await import('./leadService.js')
        const leads = await findLocalLeads(input.niche, input.location)
        memory.leads = leads
        if (leads.length) {
          const formatted = leads.map((l, i) => `${i+1}. ${l.name} — ${l.address} | ⭐ ${l.rating || 'no rating'} (${l.reviews || 0} reviews)`).join('\n')
          results.push({ type: 'tool_result', tool_use_id: id, content: `Found ${leads.length} ${input.niche} businesses in ${input.location}:\n${formatted}\n\nBest targets: low rating (3-4 stars) or few reviews = easiest to help and most likely to pay.` })
        } else {
          results.push({ type: 'tool_result', tool_use_id: id, content: `No results found for ${input.niche} in ${input.location}. Try a broader term or different area.` })
        }
      }

      // Email tools
      if (name === 'read_emails' || name === 'draft_email' || name === 'send_email' || name === 'clean_inbox' || name === 'email_summary') {
        const tokens = await getGmailTokens(sessionId)
        if (!tokens) {
          results.push({ type: 'tool_result', tool_use_id: id, content: 'Gmail not connected. Ask the user to connect Gmail in Settings first.' })
        } else {
          const { handleEmailTool } = await import('./emailService.js')
          const result = await handleEmailTool(name, input, tokens, memory, sessionId)
          results.push({ type: 'tool_result', tool_use_id: id, content: result })
        }
      }
    }

    memory.messages.push({ role: 'assistant', content: response.content })
    memory.messages.push({ role: 'user',      content: results })
    await saveSession(sessionId, memory)
    return await chatService(sessionId, '', options)
  }

  const reply = response.content[0].text
  memory.messages.push({ role: 'assistant', content: reply })
  await saveSession(sessionId, memory)
  return reply
}
