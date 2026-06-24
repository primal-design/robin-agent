import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

export interface ParsedCV {
  full_name:              string | null
  headline:               string | null
  location:               string | null
  skills:                 string[]
  experience_years:       number | null
  seniority:              string | null
  current_or_recent_role: string | null
  domains:                string[]
  target_roles:           string[]
  work_authorisation:     string | null
  inferred:               string[]
  summary:                string
}

export async function parseCV(rawText: string): Promise<ParsedCV> {
  const prompt = `Extract structured data from this CV/resume. Return ONLY valid JSON, no other text.

Extract the following. If a field is genuinely not present in the CV, return null for it — do NOT guess or invent. For fields you infer rather than read directly, include them but mark them in the "inferred" array so they can be confirmed by the candidate.

{
  "full_name": "",
  "headline": "",
  "skills": [],
  "seniority": "",
  "experience_years": null,
  "current_or_recent_role": "",
  "domains": [],
  "target_roles": [],
  "location": "",
  "work_authorisation": "",
  "inferred": []
}

Field definitions:
- full_name: candidate's full name
- headline: their current title or summary line
- skills: technical + tool skills explicitly mentioned (max 30)
- seniority: one of junior | mid | senior | lead | null — infer from years + scope
- experience_years: total years of professional experience, numeric or null
- current_or_recent_role: most recent job title
- domains: industries/sectors worked in (e.g. finance, recruitment, logistics, NHS)
- target_roles: INFERRED from background — what roles they likely want next (2-4 titles)
- location: as written on the CV, or null
- work_authorisation: ONLY if explicitly stated, e.g. "Skilled Worker Dependent visa", "right to work UK", "needs sponsorship". Otherwise null. Do NOT infer this.
- inferred: list the field names above that you inferred rather than read directly (always include target_roles and seniority here)

Rules:
- Never invent skills, titles, or experience not supported by the text.
- work_authorisation: extract ONLY if the CV explicitly states it. Never guess visa or right-to-work status.
- target_roles and seniority are best-effort inferences — always include them in the "inferred" array.
- Return valid JSON only. No markdown, no explanation.

CV text:
${rawText.slice(0, 4000)}`

  const res = await anthropic.messages.create({
    model:      env.modelFast,
    max_tokens: 800,
    messages:   [{ role: 'user', content: prompt }],
  })

  const raw = res.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')
    .trim()

  const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()

  try {
    const parsed = JSON.parse(clean)
    return {
      full_name:              parsed.full_name              ?? null,
      headline:               parsed.headline               ?? null,
      location:               parsed.location               ?? null,
      skills:                 parsed.skills                 ?? [],
      experience_years:       parsed.experience_years       ?? null,
      seniority:              parsed.seniority              ?? null,
      current_or_recent_role: parsed.current_or_recent_role ?? null,
      domains:                parsed.domains                ?? [],
      target_roles:           parsed.target_roles           ?? [],
      work_authorisation:     parsed.work_authorisation     ?? null,
      inferred:               parsed.inferred               ?? ['target_roles', 'seniority'],
      summary:                '',
    }
  } catch {
    return {
      full_name:              null,
      headline:               null,
      location:               null,
      skills:                 [],
      experience_years:       null,
      seniority:              null,
      current_or_recent_role: null,
      domains:                [],
      target_roles:           [],
      work_authorisation:     null,
      inferred:               [],
      summary:                rawText.slice(0, 300),
    }
  }
}
