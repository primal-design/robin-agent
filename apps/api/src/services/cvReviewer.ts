import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

export interface RecruiterFeedback {
  // Claude — senior in-house recruiter (hiring manager lens)
  inhouse: {
    verdict:       string   // hire / maybe / no — with one-line reason
    first_impression: string
    strengths:     string[]
    weaknesses:    string[]
    improvements:  { priority: 'high' | 'medium' | 'low'; action: string }[]
    would_call:    boolean
  }
  // GPT — agency recruiter (marketability + ATS lens)
  agency: {
    ats_score:     number   // 0-100
    ats_issues:    string[]
    keyword_gaps:  string[]
    keyword_hits:  string[]
    marketability: string
    quick_wins:    string[]
  }
}

// ── Claude Opus — in-house recruiter persona ──────────────────────────────────

async function claudeRecruiter(cvText: string, jobTitle?: string): Promise<RecruiterFeedback['inhouse']> {
  const context = jobTitle ? `The candidate is targeting roles such as: ${jobTitle}.` : ''

  const msg = await anthropic.messages.create({
    model: 'claude-opus-4-8',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `You are a senior in-house recruiter and hiring manager with 20 years of experience across tech, consulting, and enterprise companies. You have reviewed thousands of CVs and hired hundreds of people. You give honest, direct, specific feedback — not generic advice.

${context}

Review this CV and respond with valid JSON only (no markdown, no prose outside the JSON):

{
  "verdict": "hire | maybe | no — one sentence explaining why",
  "first_impression": "what you think in the first 10 seconds of reading",
  "strengths": ["specific strength 1", "specific strength 2", "specific strength 3"],
  "weaknesses": ["specific weakness 1", "specific weakness 2", "specific weakness 3"],
  "improvements": [
    { "priority": "high", "action": "specific actionable improvement" },
    { "priority": "high", "action": "specific actionable improvement" },
    { "priority": "medium", "action": "specific actionable improvement" },
    { "priority": "medium", "action": "specific actionable improvement" },
    { "priority": "low", "action": "specific actionable improvement" }
  ],
  "would_call": true or false
}

CV:
${cvText}`,
    }],
  })

  const raw = (msg.content[0] as { type: string; text: string }).text.trim()
  return JSON.parse(raw)
}

// ── GPT-5 — agency recruiter + ATS lens ──────────────────────────────────────

async function gptAgencyRecruiter(cvText: string, jobTitle?: string): Promise<RecruiterFeedback['agency']> {
  const context = jobTitle ? `Target role: ${jobTitle}.` : ''

  const res = await openai.chat.completions.create({
    model: 'gpt-4o',   // use gpt-4o as gpt-5 API name TBC
    max_tokens: 1200,
    messages: [{
      role: 'system',
      content: 'You are a senior recruitment agency consultant with 20 years placing candidates into top companies. You specialise in ATS optimisation and CV marketability. You respond only with valid JSON, no markdown.',
    }, {
      role: 'user',
      content: `${context}

Analyse this CV from an ATS and marketability perspective. Respond with valid JSON only:

{
  "ats_score": number 0-100,
  "ats_issues": ["issue that would cause ATS rejection or low ranking"],
  "keyword_hits": ["strong keywords already present"],
  "keyword_gaps": ["important keywords missing for this type of role"],
  "marketability": "one paragraph on how marketable this candidate is right now",
  "quick_wins": ["change that would immediately improve their chances", "..."]
}

CV:
${cvText}`,
    }],
  })

  const raw = res.choices[0].message.content?.trim() ?? '{}'
  // Strip markdown code fences if present
  const clean = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  return JSON.parse(clean)
}

// ── Main export — runs both in parallel ──────────────────────────────────────

export async function reviewCV(cvText: string, jobTitle?: string): Promise<RecruiterFeedback> {
  const [inhouse, agency] = await Promise.all([
    claudeRecruiter(cvText, jobTitle),
    gptAgencyRecruiter(cvText, jobTitle),
  ])
  return { inhouse, agency }
}
