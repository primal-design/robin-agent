/**
 * Leads routes
 * POST /lookup      — research a person / social handle
 * POST /find-leads  — Google Maps business leads
 * POST /analyse     — business idea analysis (SSE stream)
 * POST /profile     — save user profile source data
 * POST /task-done   — log a completed task
 */

import { Router } from 'express'
import Anthropic from '@anthropic-ai/sdk'
import { optionalAuth } from '../middleware/authMiddleware.js'
import { loadSession, saveSession, saveProfile, deleteProfile } from '../lib/db.js'
import { doResearch } from '../brain/planner.js'
import { chatService } from '../services/chatService.js'

const router  = Router()
let _ai = null
function ai() { return _ai || (_ai = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY })) }

// ── Google Maps helpers ───────────────────────────────────────────────────
async function findLocalLeads(niche, location, limit = 10) {
  if (!process.env.GOOGLE_MAPS_KEY) return []
  try {
    const query = encodeURIComponent(`${niche} in ${location}`)
    const url   = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${process.env.GOOGLE_MAPS_KEY}`
    const res   = await fetch(url)
    const data  = await res.json()
    return (data.results || []).slice(0, limit).map(p => ({
      name:     p.name,
      address:  p.formatted_address,
      rating:   p.rating,
      reviews:  p.user_ratings_total,
      place_id: p.place_id,
    }))
  } catch { return [] }
}

// POST /lookup
router.post('/lookup', optionalAuth, async (req, res, next) => {
  try {
    const { handle } = req.body
    if (!handle) return res.status(400).json({ error: 'No handle' })
    const findings = await doResearch('person', handle, 'Skills, niche, side hustle potential')
    const memory   = await loadSession(req.sessionId)
    memory.facts.push(`Social handle: ${handle}`, `Profile: ${findings.slice(0, 200)}`)
    await saveSession(req.sessionId, memory)
    res.json({ ok: true, summary: findings })
  } catch (err) { next(err) }
})

// POST /find-leads
router.post('/find-leads', optionalAuth, async (req, res, next) => {
  try {
    const { niche, location } = req.body
    if (!niche || !location) return res.status(400).json({ error: 'Need niche and location' })

    const leads = await findLocalLeads(niche, location)
    if (!leads.length) return res.json({ leads: [], message: 'No results found — try a broader niche or different location' })

    const memory = await loadSession(req.sessionId)
    memory.leads = leads
    memory.facts.push(`Looking for ${niche} leads in ${location}`)
    await saveSession(req.sessionId, memory)

    const summary = await ai().messages.create({
      model:    'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: `You are Robin. Found ${leads.length} ${niche} businesses in ${location}. Best targets are those with 3-4 star ratings (room to improve reviews) or low review counts (easy to help). Pick the top 3 targets and say why in 2 sentences. End with 🦊\n\nLeads: ${JSON.stringify(leads.slice(0, 5))}` }]
    })

    res.json({ leads, robin_take: summary.content[0].text })
  } catch (err) { next(err) }
})

// POST /analyse — SSE stream
router.post('/analyse', optionalAuth, async (req, res, next) => {
  try {
    const { idea } = req.body
    if (!idea) return res.status(400).json({ error: 'No idea' })

    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')

    const send = (layer, content) => res.write(`data: ${JSON.stringify({ layer, content })}\n\n`)

    send('status', 'Running demand check...')
    const demand      = await doResearch('trend', idea, 'Is there growing demand? Are people searching for this? What are they saying on Reddit/social?')
    send('demand', demand)

    send('status', 'Researching competitors...')
    const competition = await doResearch('competitor', idea, 'Top competitors, their pricing, what reviews say they are bad at, gaps in the market')
    send('competition', competition)

    send('status', 'Analysing market...')
    const market      = await doResearch('market', idea, 'Market size, TAM, growth rate, PESTEL risks — regulation, tech disruption, social trends')
    send('market', market)

    send('status', 'Checking keywords...')
    const keywords    = await doResearch('topic', `${idea} keywords SEO`, 'Top search keywords, content gaps, what ads competitors are running')
    send('keywords', keywords)

    send('status', 'Building your analysis...')
    const synthesis   = await ai().messages.create({
      model: 'claude-sonnet-4-6', max_tokens: 1200,
      messages: [{ role: 'user', content: `You are Robin — a sharp business analyst. Analyse this idea: "${idea}"\n\nResearch gathered:\nDEMAND: ${demand}\nCOMPETITION: ${competition}\nMARKET: ${market}\nKEYWORDS: ${keywords}\n\nNow give a structured analysis covering:\n1. SWOT (4 bullets each — specific to this idea)\n2. ICP — describe the ideal customer in 3 sentences (age, pain, where they hang out)\n3. Unit Economics — realistic price point, estimated margin, CAC challenge\n4. Verdict — GO / GO WITH CHANGES / VALIDATE FIRST / STOP + one-line reason\n5. ONE next step — the single most important thing to do in the next 48 hours\n\nBe brutally honest. Specific. No generic advice. Max 300 words total.` }]
    })
    send('analysis', synthesis.content[0].text)

    const memory = await loadSession(req.sessionId)
    memory.facts.push(`Business idea analysed: ${idea}`)
    await saveSession(req.sessionId, memory)

    send('done', 'Analysis complete')
    res.end()
  } catch (err) {
    res.write(`data: ${JSON.stringify({ layer: 'error', content: err.message })}\n\n`)
    res.end()
  }
})

// POST /profile
router.post('/profile', optionalAuth, async (req, res, next) => {
  try {
    const { sourceType, data } = req.body
    if (!data) return res.status(400).json({ error: 'No data' })
    const analysis = await ai().messages.create({
      model: 'claude-haiku-4-5-20251001', max_tokens: 300,
      messages: [{ role: 'user', content: `Extract 3-5 patterns about this person — what they do, their style, what they want. Brief.\n\n${data.slice(0, 2000)}` }]
    })
    await saveProfile(req.sessionId, sourceType, data, analysis.content[0].text)
    res.json({ ok: true, tags: analysis.content[0].text })
  } catch (err) { next(err) }
})

router.delete('/profile', optionalAuth, async (req, res, next) => {
  try {
    await deleteProfile(req.sessionId)
    res.json({ ok: true })
  } catch (err) { next(err) }
})

// POST /task-done
router.post('/task-done', optionalAuth, async (req, res, next) => {
  try {
    const { description, amount = 0 } = req.body
    const reply  = await chatService(req.sessionId, `I just completed: ${description}${amount ? `. I earned £${amount}.` : ''}`)
    const memory = await loadSession(req.sessionId)
    res.json({ reply, streak: memory.streak || 0, total_earned: memory.total_earned || 0 })
  } catch (err) { next(err) }
})

export default router
