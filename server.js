import 'dotenv/config'
import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })
const app = express()
const PORT = process.env.PORT || 3000

app.use(express.json())
app.use((req, res, next) => { res.removeHeader('Content-Security-Policy'); next() })
app.use(express.static(new URL('.', import.meta.url).pathname))
app.get('/', (req, res) => res.sendFile(new URL('index.html', import.meta.url).pathname))

// ── Per-session memory ────────────────────────────────────────────────────
function loadSession(id) {
  const store = existsSync('memory.json') ? JSON.parse(readFileSync('memory.json', 'utf8')) : {}
  return store[id] || { messages: [], facts: [] }
}

function saveSession(id, data) {
  const store = existsSync('memory.json') ? JSON.parse(readFileSync('memory.json', 'utf8')) : {}
  store[id] = { ...data, savedAt: new Date().toISOString() }
  writeFileSync('memory.json', JSON.stringify(store, null, 2))
}

// ── Robin brain ───────────────────────────────────────────────────────────
async function think(sessionId, userMessage) {
  const memory = loadSession(sessionId)
  if (userMessage) memory.messages.push({ role: 'user', content: userMessage })

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
What you know about this user: ${memory.facts.join(', ') || 'nothing yet'}`,
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
        memory.facts.push(block.input.fact)
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `Saved: ${block.input.fact}` })
      }
      if (block.name === 'build_plan') {
        memory.facts.push(`Goal: ${block.input.goal}`, `Niche: ${block.input.niche}`)
        results.push({ type: 'tool_result', tool_use_id: block.id, content: `21-DAY PLAN\nGoal: ${block.input.goal}\nNiche: ${block.input.niche}\nTime: ${block.input.timePerDay} mins/day\n\nWEEK 1: Define offer, find 10 targets, write outreach, send to 5 people\nWEEK 2: Follow up, handle replies, book calls\nWEEK 3: Run calls, send proposals, close first ${block.input.goal}\n\nSTART TODAY: Write your offer in one sentence.` })
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

// ── Chat endpoint ─────────────────────────────────────────────────────────
app.post('/chat', async (req, res) => {
  const { message, sessionId = 'web-default' } = req.body
  if (!message) return res.status(400).json({ error: 'No message' })

  try {
    const reply = await think(sessionId, message)
    res.json({ reply })
  } catch (err) {
    console.error(err.message)
    res.status(500).json({ reply: "Something went wrong — try again 🦊" })
  }
})

app.listen(PORT, () => {
  console.log(`\n🦊 Robin web app running at http://localhost:${PORT}\n`)
})
