import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

export interface ParsedCV {
  full_name:        string | null
  headline:         string | null
  location:         string | null
  skills:           string[]
  experience_years: number | null
  target_roles:     string[]
  summary:          string
}

export async function parseCV(rawText: string): Promise<ParsedCV> {
  const prompt = `Extract structured data from this CV/resume. Return ONLY valid JSON, no other text.

Fields:
- full_name: string or null
- headline: string or null (e.g. "Senior Backend Engineer" or "Marketing Manager")
- location: string or null (city/country)
- skills: array of strings (technical and soft skills, max 30)
- experience_years: integer or null (total years of professional experience)
- target_roles: array of strings (2–4 job titles this person is likely targeting based on their background)
- summary: string (2–3 sentences describing the person's background and strengths)

CV text:
${rawText.slice(0, 4000)}

Return JSON only.`

  const res = await anthropic.messages.create({
    model:      env.modelFast,
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }],
  })

  const raw = res.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')
    .trim()

  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    return JSON.parse(clean) as ParsedCV
  } catch {
    return {
      full_name:        null,
      headline:         null,
      location:         null,
      skills:           [],
      experience_years: null,
      target_roles:     [],
      summary:          rawText.slice(0, 300),
    }
  }
}
