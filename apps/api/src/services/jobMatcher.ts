import Anthropic from '@anthropic-ai/sdk'
import { pool } from '../db/pool.js'
import { env } from '../config/env.js'
import type { UserProfile } from './profileService.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

// ── Types ─────────────────────────────────────────────────────────────────────

interface JobRow {
  id:           string
  title:        string
  company:      string | null
  location:     string | null
  salary_min:   number | null
  salary_max:   number | null
  remote_type:  string | null
  description:  string | null
  embedding:    string | null   // raw text from pg, parsed to number[] after fetch
}

interface MatchResult {
  job_id:            string
  suitability_score: number
  score_breakdown:   ScoreBreakdown
  match_reasons:     string[]
  missing_skills:    string[]
  llm_summary:       string
}

interface ScoreBreakdown {
  skill_score:    number
  role_score:     number
  location_score: number
  salary_score:   number
}

// ── Hard filters ──────────────────────────────────────────────────────────────

type JobForScoring = Omit<JobRow, 'embedding'> & { embedding: number[] | null }

function passesHardFilters(job: JobForScoring, profile: UserProfile): boolean {
  // Salary too low
  if (profile.min_salary && job.salary_max && job.salary_max < profile.min_salary) return false

  // Location filter — if user has target locations, job must match one
  if (profile.target_locations.length > 0 && job.location) {
    const jobLoc = job.location.toLowerCase()
    const matches = profile.target_locations.some(l =>
      jobLoc.includes(l.toLowerCase()) || l.toLowerCase().includes('remote')
    )
    const isRemote = job.remote_type === 'remote'
    const wantsRemote = profile.preferred_work_type === 'remote' ||
                        profile.target_locations.some(l => l.toLowerCase() === 'remote')
    if (!matches && !(isRemote && wantsRemote)) return false
  }

  // Seniority filter — block management/executive roles for junior/mid candidates
  if (profile.seniority && ['junior', 'mid'].includes(profile.seniority)) {
    const overseniorPattern = /\b(director|vp |vice president|head of|chief|cto|cpo|staff engineer|principal engineer|engineering manager|senior manager|people manager)\b/i
    if (overseniorPattern.test(job.title)) return false
  }

  // Block trainee/graduate/apprentice roles for candidates with 3+ years experience
  if (profile.experience_years && profile.experience_years >= 3) {
    const juniorPattern = /\b(trainee|graduate\s+(developer|engineer|programme)|apprentice|entry.level|junior\s+trainee|no experience required)\b/i
    if (juniorPattern.test(job.title)) return false
  }

  // Role relevance filter — if profile targets recruiting/HR, require job to match
  if (profile.target_roles.length > 0) {
    const profileIsRecruiting = profile.target_roles.some(r =>
      /recruit|talent|sourc|hr|human resource/i.test(r)
    )
    if (profileIsRecruiting) {
      const recruitingPattern = /recruit|talent acquisition|talent partner|sourcing|resourcing|hr |human resource|people partner|people manager|hrbp|staffing|headhunt|hiring manager/i
      const titleMatch = recruitingPattern.test(job.title)
      const descMatch  = job.description ? recruitingPattern.test(job.description.slice(0, 500)) : false
      if (!titleMatch && !descMatch) return false
    }
  }

  return true
}

// ── Cosine similarity ─────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (!normA || !normB) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreSkills(profile: UserProfile, job: JobForScoring): number {
  if (!profile.skills.length) return 0  // no skills = can't score, penalise hard
  if (!job.description) return 40       // job has no description, neutral

  const desc = job.description.toLowerCase()
  const matched = profile.skills.filter(s => desc.includes(s.toLowerCase()))
  return Math.min(100, Math.round((matched.length / Math.max(profile.skills.length, 5)) * 100))
}

function scoreRole(profile: UserProfile, job: JobForScoring): number {
  if (!profile.target_roles.length) return 50

  const title = job.title.toLowerCase()
  for (const role of profile.target_roles) {
    const words = role.toLowerCase().split(/\s+/)
    const matchedWords = words.filter(w => title.includes(w))
    if (matchedWords.length / words.length >= 0.5) return 90
  }
  return 30
}

function scoreLocation(profile: UserProfile, job: JobForScoring): number {
  if (!profile.target_locations.length) return 70

  if (job.remote_type === 'remote') {
    if (profile.preferred_work_type === 'remote' ||
        profile.target_locations.some(l => l.toLowerCase() === 'remote')) return 100
    if (profile.preferred_work_type === 'hybrid') return 70
  }

  if (job.location) {
    const jobLoc = job.location.toLowerCase()
    for (const loc of profile.target_locations) {
      if (jobLoc.includes(loc.toLowerCase()) || loc.toLowerCase().includes(jobLoc)) return 100
    }
  }

  return 20
}

function scoreSalary(profile: UserProfile, job: JobForScoring): number {
  if (!profile.min_salary) return 70
  if (!job.salary_min && !job.salary_max) return 50  // salary hidden

  const salaryMid = ((job.salary_min ?? 0) + (job.salary_max ?? job.salary_min ?? 0)) / 2
  if (salaryMid >= profile.min_salary) return 100
  const ratio = salaryMid / profile.min_salary
  return Math.round(ratio * 100)
}

function computeScore(profile: UserProfile, job: JobForScoring): { score: number; breakdown: ScoreBreakdown } {
  const skill_score    = scoreSkills(profile, job)
  const role_score     = scoreRole(profile, job)
  const location_score = scoreLocation(profile, job)
  const salary_score   = scoreSalary(profile, job)

  const score = Math.round(
    skill_score    * 0.40 +
    role_score     * 0.25 +
    location_score * 0.20 +
    salary_score   * 0.15
  )

  return { score, breakdown: { skill_score, role_score, location_score, salary_score } }
}

// ── LLM explanation ───────────────────────────────────────────────────────────

async function explainMatch(
  profile: UserProfile,
  job: JobForScoring,
  score: number
): Promise<{ match_reasons: string[]; missing_skills: string[]; llm_summary: string }> {
  const prompt = `You are evaluating a job match for a job seeker.

Job seeker profile:
- Skills: ${profile.skills.slice(0, 15).join(', ')}
- Target roles: ${profile.target_roles.join(', ')}
- Experience: ${profile.experience_years ?? 'unknown'} years
- Location preference: ${profile.target_locations.join(', ')} / ${profile.preferred_work_type}
- Min salary: ${profile.min_salary ? '£' + profile.min_salary.toLocaleString() : 'not set'}

Job:
- Title: ${job.title}
- Company: ${job.company ?? 'Unknown'}
- Location: ${job.location ?? 'Not specified'} (${job.remote_type ?? 'unknown'})
- Salary: ${job.salary_min ? '£' + job.salary_min.toLocaleString() : '?'} – ${job.salary_max ? '£' + job.salary_max.toLocaleString() : '?'}
- Description excerpt: ${(job.description ?? '').slice(0, 800)}

Suitability score: ${score}/100

Return ONLY valid JSON:
{
  "match_reasons": ["reason 1", "reason 2"],
  "missing_skills": ["skill 1"],
  "llm_summary": "One sentence explaining why this is or isn't a good match."
}`

  try {
    const res = await anthropic.messages.create({
      model:      env.modelFast,
      max_tokens: 300,
      messages:   [{ role: 'user', content: prompt }],
    })
    const raw   = res.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('').trim()
    const clean = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(clean)
    return {
      match_reasons:  parsed.match_reasons  ?? [],
      missing_skills: parsed.missing_skills ?? [],
      llm_summary:    parsed.llm_summary    ?? '',
    }
  } catch {
    return { match_reasons: [], missing_skills: [], llm_summary: '' }
  }
}

// ── Main: match all new jobs for a profile ────────────────────────────────────

export async function matchJobsForProfile(
  tenantId:  string,
  profileId: string,
  profile:   UserProfile,
  limit = 200
): Promise<{ matched: number; topScore: number }> {
  // Get profile embedding
  const profEmbRes = await pool.query<{ embedding: string | null }>(
    `SELECT embedding FROM user_profiles WHERE id = $1`,
    [profileId]
  )
  const profileEmbedding = profEmbRes.rows[0]?.embedding
    ? (JSON.parse(profEmbRes.rows[0].embedding) as number[])
    : null

  // Fetch candidate jobs not yet matched for this profile
  const jobsRes = await pool.query<JobRow>(
    `SELECT j.id, j.title, j.company, j.location, j.salary_min, j.salary_max,
            j.remote_type, j.description,
            j.embedding::text AS embedding
     FROM jobs j
     WHERE j.is_active = true
       AND NOT EXISTS (
         SELECT 1 FROM job_matches m
         WHERE m.profile_id = $1 AND m.job_id = j.id
       )
     ORDER BY j.fetched_at DESC
     LIMIT $2`,
    [profileId, limit]
  )

  type ParsedJob = Omit<JobRow, 'embedding'> & { embedding: number[] | null }
  const candidates: ParsedJob[] = jobsRes.rows.map(j => ({
    ...j,
    embedding: j.embedding ? (JSON.parse(j.embedding) as number[]) : null,
  }))

  // Filter and score
  const results: MatchResult[] = []

  for (const job of candidates) {
    if (!passesHardFilters(job, profile)) continue

    const { score, breakdown } = computeScore(profile, job)

    // Boost score using embedding similarity if available
    let finalScore = score
    if (profileEmbedding && job.embedding) {
      const sim = cosineSimilarity(profileEmbedding, job.embedding)
      // Blend: 70% deterministic + 30% semantic
      finalScore = Math.round(score * 0.7 + sim * 100 * 0.3)
    }

    if (finalScore < 30) continue  // drop very low matches

    // Only call LLM for decent matches to control cost — skip if no API credits
    let explanation = { match_reasons: [] as string[], missing_skills: [] as string[], llm_summary: '' }
    if (finalScore >= 50) {
      try {
        explanation = await explainMatch(profile, job, finalScore)
      } catch (err) {
        console.warn('[jobMatcher] LLM explain failed (no credits?):', err instanceof Error ? err.message : err)
      }
    }

    results.push({
      job_id:            job.id,
      suitability_score: finalScore,
      score_breakdown:   breakdown,
      match_reasons:     explanation.match_reasons,
      missing_skills:    explanation.missing_skills,
      llm_summary:       explanation.llm_summary,
    })
  }

  if (!results.length) return { matched: 0, topScore: 0 }

  // Bulk insert matches
  const client = await pool.connect()
  try {
    for (const m of results) {
      await client.query(
        `INSERT INTO job_matches
           (tenant_id, profile_id, job_id, suitability_score, score_breakdown,
            match_reasons, missing_skills, llm_summary)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (profile_id, job_id) DO NOTHING`,
        [
          tenantId, profileId, m.job_id, m.suitability_score,
          JSON.stringify(m.score_breakdown),
          m.match_reasons,
          m.missing_skills,
          m.llm_summary,
        ]
      )
    }
  } finally {
    client.release()
  }

  const topScore = Math.max(...results.map(r => r.suitability_score))
  console.log(`[jobMatcher] profile ${profileId}: ${results.length} matches, top score ${topScore}`)

  return { matched: results.length, topScore }
}

// ── Get top matches for a profile ─────────────────────────────────────────────

export async function getTopMatches(
  tenantId:  string,
  profileId: string,
  limit = 10,
  minScore = 40
): Promise<Array<{
  match_id:          string
  job_id:            string
  title:             string
  company:           string | null
  location:          string | null
  salary_min:        number | null
  salary_max:        number | null
  remote_type:       string | null
  url:               string | null
  suitability_score: number
  match_reasons:     string[]
  missing_skills:    string[]
  llm_summary:       string | null
  sent_to_telegram:  boolean
  user_feedback:     string | null
}>> {
  const r = await pool.query(
    `SELECT m.id AS match_id, m.job_id, j.title, j.company, j.location,
            j.salary_min, j.salary_max, j.remote_type, j.url,
            m.suitability_score, m.match_reasons, m.missing_skills,
            m.llm_summary, m.sent_to_telegram, m.user_feedback
     FROM job_matches m
     JOIN jobs j ON j.id = m.job_id
     WHERE m.profile_id = $1
       AND m.tenant_id  = $2
       AND m.suitability_score >= $3
       AND j.is_active = true
     ORDER BY m.suitability_score DESC
     LIMIT $4`,
    [profileId, tenantId, minScore, limit]
  )
  return r.rows
}
