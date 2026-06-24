import Anthropic from '@anthropic-ai/sdk'
import { env } from '../config/env.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

export interface WorkHistoryEntry {
  employer:   string
  title:      string
  start_date: string | null
  end_date:   string | null  // null = current
  summary:    string | null
}

export interface EducationEntry {
  institution: string
  qualification: string
  field:       string | null
  year:        number | null
}

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
  work_history:           WorkHistoryEntry[]
  education:              EducationEntry[]
  certifications:         string[]
  languages:              string[]
  inferred:               string[]
  summary:                string
}

export async function parseCV(rawText: string): Promise<ParsedCV> {
  const prompt = `Extract structured data from this CV/resume. Return ONLY valid JSON, no other text.

Extract the following fields. If a field is genuinely not present, return null or [] — do NOT guess or invent. For fields you infer rather than read directly, include them in the "inferred" array.

{
  "full_name": "",
  "headline": "",
  "location": "",
  "skills": [],
  "seniority": "",
  "experience_years": null,
  "current_or_recent_role": "",
  "domains": [],
  "target_roles": [],
  "work_authorisation": null,
  "work_history": [
    { "employer": "", "title": "", "start_date": "", "end_date": "", "summary": "" }
  ],
  "education": [
    { "institution": "", "qualification": "", "field": "", "year": null }
  ],
  "certifications": [],
  "languages": [],
  "inferred": []
}

Field definitions:
- full_name: candidate's full name
- headline: their current title or summary line
- location: as written on the CV, or null
- skills: technical + tool skills explicitly mentioned (max 30)
- seniority: one of junior | mid | senior | lead | null — infer from years + scope
- experience_years: total years of professional experience, numeric or null
- current_or_recent_role: most recent job title
- domains: industries/sectors worked in (e.g. finance, recruitment, NHS)
- target_roles: INFERRED from background — what roles they likely want next (2-4 titles)
- work_authorisation: ONLY if explicitly stated (e.g. "right to work UK", "needs sponsorship"). Never infer.
- work_history: all jobs listed — employer, title, start_date (e.g. "Jan 2020"), end_date (null if current), summary (1 sentence)
- education: all degrees/diplomas — institution, qualification (e.g. "BSc"), field (subject), year (graduation year or null)
- certifications: professional certs explicitly listed (e.g. "CIPD Level 5", "AWS Solutions Architect")
- languages: languages spoken if listed
- inferred: always include "target_roles" and "seniority"; add any other inferred fields

Rules:
- Never invent jobs, education, or certifications not in the text.
- work_authorisation: extract ONLY if explicitly stated. Never guess.
- Return valid JSON only. No markdown, no explanation.

CV text:
${rawText.slice(0, 6000)}`

  const res = await anthropic.messages.create({
    model:      env.modelFast,
    max_tokens: 2000,
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
      work_history:           parsed.work_history           ?? [],
      education:              parsed.education              ?? [],
      certifications:         parsed.certifications         ?? [],
      languages:              parsed.languages              ?? [],
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
      work_history:           [],
      education:              [],
      certifications:         [],
      languages:              [],
      inferred:               [],
      summary:                rawText.slice(0, 300),
    }
  }
}
