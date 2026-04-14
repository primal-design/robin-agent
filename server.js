import 'dotenv/config'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@supabase/supabase-js'

const ai  = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })
const sb  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json({ limit: '2mb' }))
app.use((req, res, next) => { res.removeHeader('Content-Security-Policy'); next() })
app.use(express.static(new URL('.', import.meta.url).pathname))
app.get('/', (req, res) => res.sendFile(new URL('index.html', import.meta.url).pathname))

// ── Session helpers ───────────────────────────────────────────────────────
async function loadSession(id) {
  const { data } = await sb.from('sessions').select('*').eq('session_id', id).single()
  return data || { session_id: id, messages: [], facts: [] }
}

async function saveSession(id, data) {
  await sb.from('sessions').upsert({
    session_id: id,
    messages: data.messages,
    facts: data.facts,
    updated_at: new Date().toISOString()
  }, { onConflict: 'session_id' })
}

// ── Consent helpers ───────────────────────────────────────────────────────
async function logConsent(sessionId, type, version = '1.0') {
  await sb.from('consents').insert({ user_id: sessionId, type, version })
  await auditLog(sessionId, 'consent_given', { type, version })
}

async function auditLog(sessionId, event, metadata = {}) {
  await sb.from('audit_log').insert({ session_id: sessionId, event, metadata })
}

// ── Profile helpers ───────────────────────────────────────────────────────
async function loadProfile(sessionId) {
  const { data } = await sb.from('profiles')
    .select('*')
    .eq('session_id', sessionId)
    .gt('delete_after', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .single()
  return data || null
}

async function saveProfileData(sessionId, sourceType, rawData) {
  // Save source
  await sb.from('sources').insert({
    session_id: sessionId,
    type: sourceType,
    raw_data: rawData.slice(0, 5000),
    delete_after: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  })

  // Extract patterns via Claude
  const analysis = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: `Analyse this and extract 3-5 light patterns about the person — what they work on, their style, what they seem to want. Be brief and factual.\n\n${rawData.slice(0, 2000)}` }]
  })
  const summary = analysis.content[0].text

  // Upsert profile
  const existing = await loadProfile(sessionId)
  if (existing) {
    await sb.from('profiles').update({ summary, updated_at: new Date().toISOString() }).eq('id', existing.id)
  } else {
    await sb.from('profiles').insert({
      session_id: sessionId,
      summary,
      delete_after: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    })
  }

  await auditLog(sessionId, 'profile_created', { source_type: sourceType })
  return summary
}

// ── Robin brain ───────────────────────────────────────────────────────────
async function think(sessionId, userMessage) {
  const memory  = await loadSession(sessionId)
  const profile = await loadProfile(sessionId)

  if (userMessage) memory.messages.push({ role: 'user', content: userMessage })

  const profileContext = profile
    ? `\nUser profile (uploaded by user):\n${profile.summary}`
    : ''

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
What you know about this user: ${(memory.facts || []).join(', ') || 'nothing yet'}${profileContext}`,
    tools: [
      { name: 'remember_fact', description: 'Remember a fact about the user', input_schema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
      { name: 'build_plan', description: 'Build a 21 day action plan', input_schema: { type: 'object', properties: { goal: { type: 'string' }, niche: { type: 'string' }, timePerDay: { type: 'number' } }, required: ['goal', 'niche', 'timePerDay'] } },
    ],
    messages: memory.messages.slice(-20)
  })

  if (response.stop_reason === 'tool_use') {
    const results = []
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue
      if (block.name === 'remember_fact') {
        memory.facts = [...(memory.facts || []), block.input.fact]
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `Saved: ${block.input.fact}` })
      }
      if (block.name === 'build_plan') {
        memory.facts = [...(memory.facts || []), `Goal: ${block.input.goal}`, `Niche: ${block.input.niche}`]
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `21-DAY PLAN\nGoal: ${block.input.goal}\nNiche: ${block.input.niche}\nTime: ${block.input.timePerDay} mins/day\n\nWEEK 1: Define offer, find 10 targets, write outreach, send to 5 people\nWEEK 2: Follow up, handle replies, book calls\nWEEK 3: Run calls, send proposals, close first ${block.input.goal}\n\nSTART TODAY: Write your offer in one sentence.` })
      }
    }
    memory.messages.push({ role: 'assistant', content: response.content })
    memory.messages.push({ role: 'user', content: results })
    await saveSession(sessionId, memory)
    return await think(sessionId, '')
  }

  const reply = response.content[0].text
  memory.messages.push({ role: 'assistant', content: reply })
  await saveSession(sessionId, memory)
  return reply
}

// ── Chat ──────────────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, sessionId = 'web-default' } = req.body
  if (!message) return res.status(400).json({ error: 'No message' })
  try {
    const memory = await loadSession(sessionId)
    const isFirstReply = (memory.messages || []).filter(m => m.role === 'assistant').length === 0
    const reply = await think(sessionId, message)
    res.json({ reply, showProfilePrompt: isFirstReply })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ reply: "Something went wrong — try again 🦊" })
  }
})

// ── Consent ───────────────────────────────────────────────────────────────
app.post('/consent', async (req, res) => {
  const { sessionId, type } = req.body
  await logConsent(sessionId, type)
  res.json({ ok: true })
})

// ── Profile ───────────────────────────────────────────────────────────────
app.post('/profile', async (req, res) => {
  const { sessionId = 'web-default', sourceType, data } = req.body
  if (!data) return res.status(400).json({ error: 'No data' })
  await logConsent(sessionId, 'profile_analysis')
  const tags = await saveProfileData(sessionId, sourceType, data)
  res.json({ ok: true, tags })
})

app.delete('/profile', async (req, res) => {
  const { sessionId = 'web-default' } = req.body
  await sb.from('sources').update({ status: 'deleted', raw_data: null }).eq('session_id', sessionId)
  await sb.from('profiles').delete().eq('session_id', sessionId)
  await auditLog(sessionId, 'profile_deleted')
  res.json({ ok: true })
})

// ── /my-data — structured GDPR export ────────────────────────────────────
app.get('/my-data/:sessionId', async (req, res) => {
  const sid = req.params.sessionId
  const [session, profile, sources, consents, actions] = await Promise.all([
    sb.from('sessions').select('facts, created_at, updated_at').eq('session_id', sid).single(),
    sb.from('profiles').select('summary, facts, preferences, created_at, updated_at, delete_after').eq('session_id', sid).single(),
    sb.from('sources').select('source_id, type, status, created_at, delete_after').eq('session_id', sid),
    sb.from('consents').select('type, version, given_at, revoked_at').eq('user_id', sid),
    sb.from('actions').select('type, status, scheduled_at, created_at').eq('session_id', sid)
  ])

  await auditLog(sid, 'data_exported')

  res.json({
    user_id: sid,
    profile: profile.data ? {
      summary: profile.data.summary,
      facts: profile.data.facts,
      preferences: profile.data.preferences,
      last_updated_at: profile.data.updated_at,
      deletes_at: profile.data.delete_after
    } : null,
    uploaded_sources: (sources.data || []).map(s => ({
      source_id: s.source_id, type: s.type, status: s.status,
      uploaded_at: s.created_at, deletes_at: s.delete_after
    })),
    generated_facts: session.data?.facts || [],
    consent_history: consents.data || [],
    connected_accounts: [],
    scheduled_actions: (actions.data || []).filter(a => a.type === 'scheduled'),
    drafts: (actions.data || []).filter(a => a.type === 'draft'),
    rights: { can_export: true, can_delete: true }
  })
})

// ── /delete-account — full GDPR deletion ─────────────────────────────────
app.delete('/delete-account', async (req, res) => {
  const { sessionId } = req.body
  if (!sessionId) return res.status(400).json({ error: 'No sessionId' })

  // 1. Wipe sources (raw data)
  await sb.from('sources').update({ status: 'deleted', raw_data: null }).eq('session_id', sessionId)
  // 2. Wipe profile
  await sb.from('profiles').delete().eq('session_id', sessionId)
  // 3. Cancel scheduled actions
  await sb.from('actions').update({ status: 'cancelled' }).eq('session_id', sessionId).eq('status', 'pending')
  // 4. Revoke consents
  await sb.from('consents').update({ revoked_at: new Date().toISOString() }).eq('user_id', sessionId).is('revoked_at', null)
  // 5. Wipe session messages (keep session row for audit ref)
  await sb.from('sessions').update({ messages: [], facts: [] }).eq('session_id', sessionId)
  // 6. Audit log retained separately (legal requirement)
  await auditLog(sessionId, 'account_deleted', { note: 'audit_log_retained_per_legal_requirement' })

  res.json({ ok: true, note: 'All personal data deleted. Audit log retained as required by law.' })
})

app.listen(PORT, () => {
  console.log(`\n🦊 Robin running at http://localhost:${PORT}\n`)
})
