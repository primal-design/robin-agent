import Anthropic from '@anthropic-ai/sdk'
import { pool } from '../db/pool.js'
import { env } from '../config/env.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

// ── Types ─────────────────────────────────────────────────────────────────────

interface TailorInput {
  tenantId:       string
  profileId:      string
  applicationId:  string
  rawCvText:      string
  jobTitle:       string
  jobCompany:     string | null
  jobDescription: string | null
  matchReasons:   string[]
  missingSkills:  string[]
}

interface TailoredDocs {
  resumeId:      string
  coverLetterId: string
  cvContent:     string
  clContent:     string
}

// ── CV Tailoring ──────────────────────────────────────────────────────────────

async function tailorCV(input: TailorInput): Promise<string> {
  const prompt = `You are an expert CV writer helping a job seeker tailor their CV for a specific role.

ORIGINAL CV:
${input.rawCvText.slice(0, 4000)}

TARGET JOB:
Title: ${input.jobTitle}
Company: ${input.jobCompany ?? 'Not specified'}
Description: ${(input.jobDescription ?? '').slice(0, 2000)}

MATCH CONTEXT:
- Strengths for this role: ${input.matchReasons.join(', ') || 'None identified'}
- Skills to highlight if present: ${input.missingSkills.join(', ') || 'None'}

INSTRUCTIONS:
1. Rewrite the CV to emphasise experience and skills most relevant to this role
2. Reorder bullet points so the most relevant achievements come first
3. Mirror key language from the job description naturally (no keyword stuffing)
4. Keep all facts truthful — do not invent experience
5. Professional format: Name, Contact, Summary, Experience, Skills, Education
6. Return ONLY the tailored CV text, no explanations`

  const res = await anthropic.messages.create({
    model:      env.modelReasoning,
    max_tokens: 2000,
    messages:   [{ role: 'user', content: prompt }],
  })

  return res.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')
    .trim()
}

// ── Cover Letter Generation ───────────────────────────────────────────────────

async function generateCoverLetter(input: TailorInput, tailoredCV: string): Promise<string> {
  const prompt = `You are an expert cover letter writer. Write a compelling, concise cover letter.

TAILORED CV (for context):
${tailoredCV.slice(0, 2000)}

TARGET JOB:
Title: ${input.jobTitle}
Company: ${input.jobCompany ?? 'this company'}
Description: ${(input.jobDescription ?? '').slice(0, 1500)}

INSTRUCTIONS:
1. Three paragraphs: hook + why this role/company, relevant achievements, call to action
2. Specific and personal — reference actual experience from the CV
3. Mirror the company's tone (startup = energetic, enterprise = professional)
4. Max 300 words
5. Do NOT use "I am writing to apply for..." as the opening
6. Return ONLY the cover letter text, no subject line or address block`

  const res = await anthropic.messages.create({
    model:      env.modelReasoning,
    max_tokens: 600,
    messages:   [{ role: 'user', content: prompt }],
  })

  return res.content
    .filter(b => b.type === 'text')
    .map(b => (b as { type: 'text'; text: string }).text)
    .join('')
    .trim()
}

// ── Persist to DB ─────────────────────────────────────────────────────────────

async function saveDocuments(input: TailorInput, cvContent: string, clContent: string): Promise<{ resumeId: string; coverLetterId: string }> {
  const client = await pool.connect()
  try {
    // Get next version for this application
    const versionRes = await client.query<{ max: number | null }>(
      `SELECT MAX(version) AS max FROM resumes WHERE application_id = $1`,
      [input.applicationId]
    )
    const version = (versionRes.rows[0]?.max ?? 0) + 1

    const resumeRes = await client.query<{ id: string }>(
      `INSERT INTO resumes
         (tenant_id, application_id, profile_id, content, format, version, is_base)
       VALUES ($1, $2, $3, $4, 'text', $5, false)
       RETURNING id`,
      [input.tenantId, input.applicationId, input.profileId, cvContent, version]
    )
    const resumeId = resumeRes.rows[0].id

    const clRes = await client.query<{ id: string }>(
      `INSERT INTO cover_letters
         (tenant_id, application_id, content, version)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [input.tenantId, input.applicationId, clContent, version]
    )
    const coverLetterId = clRes.rows[0].id

    // Link back to application
    await client.query(
      `UPDATE applications
       SET tailored_cv_id   = $1,
           cover_letter_id  = $2,
           status           = 'draft_ready',
           last_update_at   = now()
       WHERE id = $3`,
      [resumeId, coverLetterId, input.applicationId]
    )

    // Log event
    await client.query(
      `INSERT INTO application_events
         (tenant_id, application_id, event_type, note)
       VALUES ($1, $2, 'CV_TAILORED', $3)`,
      [input.tenantId, input.applicationId, `Version ${version} generated`]
    )
    await client.query(
      `INSERT INTO application_events
         (tenant_id, application_id, event_type, note)
       VALUES ($1, $2, 'COVER_LETTER_DRAFTED', $3)`,
      [input.tenantId, input.applicationId, `Version ${version} generated`]
    )

    return { resumeId, coverLetterId }
  } finally {
    client.release()
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function tailorDocuments(input: TailorInput): Promise<TailoredDocs> {
  console.log(`[documentTailor] Tailoring CV + cover letter for application ${input.applicationId}`)

  const [cvContent, clContent] = await Promise.all([
    tailorCV(input),
    generateCoverLetter(input, input.rawCvText), // use raw CV for CL — tailored not ready yet
  ])

  const { resumeId, coverLetterId } = await saveDocuments(input, cvContent, clContent)

  console.log(`[documentTailor] Done — resume ${resumeId}, cover letter ${coverLetterId}`)
  return { resumeId, coverLetterId, cvContent, clContent }
}

// ── Convenience: load all inputs from DB and tailor ───────────────────────────

export async function tailorForApplication(
  tenantId:      string,
  applicationId: string
): Promise<TailoredDocs> {
  const r = await pool.query<{
    profile_id:      string
    raw_cv_text:     string | null
    job_title:       string
    job_company:     string | null
    job_description: string | null
    match_reasons:   string[] | null
    missing_skills:  string[] | null
  }>(
    `SELECT
       a.profile_id,
       p.raw_cv_text,
       j.title     AS job_title,
       j.company   AS job_company,
       j.description AS job_description,
       m.match_reasons,
       m.missing_skills
     FROM applications a
     JOIN user_profiles p ON p.id = a.profile_id
     JOIN jobs          j ON j.id = a.job_id
     LEFT JOIN job_matches m ON m.profile_id = a.profile_id AND m.job_id = a.job_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [applicationId, tenantId]
  )

  if (!r.rows[0]) throw new Error(`Application ${applicationId} not found`)

  const row = r.rows[0]
  if (!row.raw_cv_text) throw new Error('No CV uploaded for this profile')

  return tailorDocuments({
    tenantId,
    profileId:      row.profile_id,
    applicationId,
    rawCvText:      row.raw_cv_text,
    jobTitle:       row.job_title,
    jobCompany:     row.job_company,
    jobDescription: row.job_description,
    matchReasons:   row.match_reasons ?? [],
    missingSkills:  row.missing_skills ?? [],
  })
}
