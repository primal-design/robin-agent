import 'dotenv/config'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY || '' })
console.log('🔑 Anthropic key loaded:', process.env.ANTHROPIC_KEY ? 'YES' : 'NO')
console.log('🔑 Moonshot key loaded:', process.env.MOONSHOT_KEY ? 'YES' : 'NO')

// ── Moonshot Kimi — for lighter tasks with Claude fallback ────────────────
async function kimiOrClaude(prompt) {
  if (process.env.MOONSHOT_KEY) {
    try {
      const res = await fetch('https://api.moonshot.cn/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${process.env.MOONSHOT_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'moonshot-v1-8k', messages: [{ role: 'user', content: prompt }], max_tokens: 1500 })
      })
      const data = await res.json()
      const result = data.choices?.[0]?.message?.content
      if (result) return result
    } catch (e) { console.log('Moonshot failed, falling back to Claude') }
  }
  // Fallback to Claude Haiku
  const response = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }]
  })
  return response.content[0].text
}

// ── Config (set these in your environment) ─────────────────────────────────
const VERIFY_TOKEN   = process.env.WA_VERIFY_TOKEN   // any string you pick
const ACCESS_TOKEN   = process.env.WA_ACCESS_TOKEN   // from Meta dashboard
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID // from Meta dashboard
const PORT = process.env.PORT || 3000

// ── Per-user memory (stored in memory.json keyed by phone number) ──────────
function loadUser(phone) {
  const store = existsSync('memory.json')
    ? JSON.parse(readFileSync('memory.json', 'utf8'))
    : {}
  return store[phone] || { messages: [], facts: [] }
}

function saveUser(phone, data) {
  const store = existsSync('memory.json')
    ? JSON.parse(readFileSync('memory.json', 'utf8'))
    : {}
  store[phone] = { ...data, savedAt: new Date().toISOString() }
  writeFileSync('memory.json', JSON.stringify(store, null, 2))
}

// ── Robin brain (same logic as agent.js) ──────────────────────────────────
async function think(phone, userMessage) {
  const memory = loadUser(phone)
  if (userMessage) memory.messages.push({ role: 'user', content: userMessage })

  const response = await ai.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    system: `You're Robin — a real one. Sharp, laid-back, someone who actually listens before jumping in.
You talk like a real person — casual, warm, direct. No corporate energy.
Your first job is to understand the person you're talking to. Get to know them. What are they working on, what's their situation, what do they actually want. Build that connection naturally through conversation.
Don't rush to build plans or take action unless the user explicitly asks for it — words like "build", "make me a plan", "let's go", "set it up" are your signal to act.
Until then, just vibe, get to know them, ask one good question at a time.
One or two short sentences max. Keep it punchy. End every message with 🦊

Current time: ${new Date().toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', hour12: true })}
If this is the first message, open with a natural time-aware greeting based on the hour — don't announce the time, just let it shape the vibe.
What you know about this user: ${memory.facts.join(', ') || 'nothing yet'}`,
    tools: [
      { name: 'remember_fact', description: 'Remember a fact about the user', input_schema: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
      { name: 'build_plan', description: 'Build a 21 day action plan', input_schema: { type: 'object', properties: { goal: { type: 'string' }, niche: { type: 'string' }, timePerDay: { type: 'number' } }, required: ['goal', 'niche', 'timePerDay'] } },
      { name: 'research_person', description: 'Research a person using their social media handles', input_schema: { type: 'object', properties: { name: { type: 'string' }, instagram: { type: 'string' }, twitter: { type: 'string' } }, required: ['name'] } }
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
        const plan = await kimiOrClaude(`Create a practical 21-day action plan for someone who wants to: ${block.input.goal}. Their niche is: ${block.input.niche}. They have ${block.input.timePerDay} minutes per day. Break it into 3 weeks with daily tasks. Be specific and actionable. Keep it concise.`)
        results.push({ type: 'tool_result', tool_use_id: block.id, content: plan })
      }
      if (block.name === 'research_person') {
        const { name, instagram, twitter } = block.input
        let findings = `Research on ${name}:\n`
        if (process.env.BRAVE_KEY) {
          const searches = [instagram, twitter, name].filter(Boolean)
          for (const handle of searches) {
            try {
              const res = await fetch(
                `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(handle + ' side hustle business')}&count=2`,
                { headers: { 'X-Subscription-Token': process.env.BRAVE_KEY, 'Accept': 'application/json' } }
              )
              const data = await res.json()
              const snippet = data.web?.results?.[0]?.description || ''
              if (snippet) findings += snippet + '\n'
            } catch(e) { findings += 'Search error\n' }
          }
        } else {
          findings += 'No Brave key yet — add BRAVE_KEY to .env for real search results'
        }
        memory.facts.push(`Research done on: ${name}`)
        results.push({ type: 'tool_result', tool_use_id: block.id, content: findings })
      }
    }
    memory.messages.push({ role: 'assistant', content: response.content })
    memory.messages.push({ role: 'user', content: results })
    saveUser(phone, memory)
    return await think(phone, '')
  }

  const reply = response.content[0].text
  memory.messages.push({ role: 'assistant', content: reply })
  saveUser(phone, memory)
  return reply
}

// ── Send WhatsApp message ─────────────────────────────────────────────────
async function sendMessage(to, text, phoneNumberId = PHONE_NUMBER_ID) {
  await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text }
    })
  })
}

// ── Express server ────────────────────────────────────────────────────────
const app = express()
app.use(express.json())

// Webhook verification (Meta calls this once when you set it up)
app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    console.log('✅ Webhook verified')
    res.send(req.query['hub.challenge'])
  } else {
    res.sendStatus(403)
  }
})

// Incoming messages
app.post('/webhook', async (req, res) => {
  res.sendStatus(200) // ACK immediately so Meta doesn't retry

  const entry = req.body?.entry?.[0]?.changes?.[0]?.value
  const msg = entry?.messages?.[0]
  if (!msg || msg.type !== 'text') return

  const phone = msg.from
  const text  = msg.text.body
  const incomingPhoneId = entry?.metadata?.phone_number_id || PHONE_NUMBER_ID
  console.log(`📱 ${phone} → ${incomingPhoneId}: ${text}`)

  try {
    const reply = await think(phone, text)
    await sendMessage(phone, reply, incomingPhoneId)
    console.log(`🦊 Robin → ${phone}: ${reply}`)
  } catch (err) {
    console.error('Error:', err.message)
    await sendMessage(phone, "Something went wrong on my end — try again in a sec 🦊")
  }
})

app.listen(PORT, () => {
  console.log(`\n🦊 Robin WhatsApp webhook running on port ${PORT}`)
  console.log(`Webhook URL: http://your-domain.com/webhook\n`)
})
