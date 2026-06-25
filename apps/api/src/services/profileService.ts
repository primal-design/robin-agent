import type { PoolClient } from 'pg'
import { pool } from '../db/pool.js'
import { parseCV } from './cvParser.js'
import type { WorkHistoryEntry, EducationEntry } from './cvParser.js'
import { embedTexts } from '../lib/embed.js'

export interface UserProfile {
  id:                    string
  tenant_id:             string
  full_name:             string | null
  headline:              string | null
  location:              string | null
  target_roles:          string[]
  target_locations:      string[]
  min_salary:            number | null
  preferred_work_type:   string
  skills:                string[]
  experience_years:      number | null
  raw_cv_text:           string | null
  seniority:             string | null
  current_or_recent_role:string | null
  domains:               string[]
  work_authorisation:    string | null
  notice_period:         string | null
  avoid_roles:           string[]
  confirmed_fields:      string[]
  work_history:          WorkHistoryEntry[]
  education:             EducationEntry[]
  certifications:        string[]
  languages:             string[]
  created_at:            string
  updated_at:            string
}

// ── Get profile for tenant ────────────────────────────────────────────────────

export async function getProfile(tenantId: string): Promise<UserProfile | null> {
  const r = await pool.query<UserProfile>(
    `SELECT id, tenant_id, full_name, headline, location,
            target_roles, target_locations, min_salary,
            preferred_work_type, skills, experience_years,
            raw_cv_text, seniority, current_or_recent_role, domains,
            work_authorisation, notice_period, avoid_roles, confirmed_fields,
            work_history, education, certifications, languages,
            created_at, updated_at
     FROM user_profiles
     WHERE tenant_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [tenantId]
  )
  return r.rows[0] ?? null
}

// ── Create or update profile ──────────────────────────────────────────────────

export async function upsertProfile(
  tenantId: string,
  params: Partial<Omit<UserProfile, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>>
): Promise<UserProfile> {
  const existing = await getProfile(tenantId)

  if (existing) {
    const r = await pool.query<UserProfile>(
      `UPDATE user_profiles
       SET full_name              = COALESCE($1,  full_name),
           headline               = COALESCE($2,  headline),
           location               = COALESCE($3,  location),
           target_roles           = COALESCE($4,  target_roles),
           target_locations       = COALESCE($5,  target_locations),
           min_salary             = COALESCE($6,  min_salary),
           preferred_work_type    = COALESCE($7,  preferred_work_type),
           skills                 = COALESCE($8,  skills),
           experience_years       = COALESCE($9,  experience_years),
           raw_cv_text            = COALESCE($10, raw_cv_text),
           seniority              = COALESCE($11, seniority),
           current_or_recent_role = COALESCE($12, current_or_recent_role),
           domains                = COALESCE($13, domains),
           work_authorisation     = COALESCE($14, work_authorisation),
           notice_period          = COALESCE($15, notice_period),
           avoid_roles            = COALESCE($16, avoid_roles),
           work_history           = COALESCE($17, work_history),
           education              = COALESCE($18, education),
           certifications         = COALESCE($19, certifications),
           languages              = COALESCE($20, languages),
           updated_at             = now()
       WHERE id = $21
       RETURNING *`,
      [
        params.full_name              ?? null,
        params.headline               ?? null,
        params.location               ?? null,
        params.target_roles           ?? null,
        params.target_locations       ?? null,
        params.min_salary             ?? null,
        params.preferred_work_type    ?? null,
        params.skills                 ?? null,
        params.experience_years       ?? null,
        params.raw_cv_text            ?? null,
        params.seniority              ?? null,
        params.current_or_recent_role ?? null,
        params.domains                ?? null,
        params.work_authorisation     ?? null,
        params.notice_period          ?? null,
        params.avoid_roles            ?? null,
        params.work_history           ? JSON.stringify(params.work_history)   : null,
        params.education              ? JSON.stringify(params.education)       : null,
        params.certifications         ?? null,
        params.languages              ?? null,
        existing.id,
      ]
    )
    return r.rows[0]
  }

  const r = await pool.query<UserProfile>(
    `INSERT INTO user_profiles
       (tenant_id, full_name, headline, location, target_roles, target_locations,
        min_salary, preferred_work_type, skills, experience_years, raw_cv_text,
        seniority, current_or_recent_role, domains, work_authorisation,
        work_history, education, certifications, languages)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      tenantId,
      params.full_name              ?? null,
      params.headline               ?? null,
      params.location               ?? null,
      params.target_roles           ?? [],
      params.target_locations       ?? [],
      params.min_salary             ?? null,
      params.preferred_work_type    ?? 'any',
      params.skills                 ?? [],
      params.experience_years       ?? null,
      params.raw_cv_text            ?? null,
      params.seniority              ?? null,
      params.current_or_recent_role ?? null,
      params.domains                ?? [],
      params.work_authorisation     ?? null,
      params.work_history           ? JSON.stringify(params.work_history)   : '[]',
      params.education              ? JSON.stringify(params.education)       : '[]',
      params.certifications         ?? [],
      params.languages              ?? [],
    ]
  )
  return r.rows[0]
}

// ── Upload CV: parse + embed + overwrite CV-derived fields ───────────────────

export async function uploadCV(
  tenantId: string,
  rawCvText: string
): Promise<{ profile: UserProfile; parsed: Awaited<ReturnType<typeof parseCV>> }> {
  // Parse CV fields with LLM
  const parsed = await parseCV(rawCvText)

  const existing = await getProfile(tenantId)

  // CV upload always overwrites CV-derived fields — never COALESCE them
  if (existing) {
    await pool.query(
      `UPDATE user_profiles
       SET full_name              = COALESCE($1,  full_name),
           headline               = COALESCE($2,  headline),
           location               = COALESCE($3,  location),
           skills                 = $4,
           experience_years       = COALESCE($5,  experience_years),
           target_roles           = $6,
           seniority              = $7,
           current_or_recent_role = COALESCE($8,  current_or_recent_role),
           domains                = $9,
           work_authorisation     = COALESCE($10, work_authorisation),
           work_history           = $11,
           education              = $12,
           certifications         = $13,
           languages              = $14,
           raw_cv_text            = $15,
           updated_at             = now()
       WHERE id = $16`,
      [
        parsed.full_name              ?? null,
        parsed.headline               ?? null,
        parsed.location               ?? null,
        parsed.skills,
        parsed.experience_years       ?? null,
        parsed.target_roles,
        parsed.seniority              ?? null,
        parsed.current_or_recent_role ?? null,
        parsed.domains,
        parsed.work_authorisation     ?? null,
        JSON.stringify(parsed.work_history),
        JSON.stringify(parsed.education),
        parsed.certifications,
        parsed.languages,
        rawCvText,
        existing.id,
      ]
    )
    const profile = await getProfile(tenantId)
    return { profile: profile!, parsed }
  }

  // New profile — insert
  const profile = await upsertProfile(tenantId, {
    full_name:             parsed.full_name              ?? undefined,
    headline:              parsed.headline               ?? undefined,
    location:              parsed.location               ?? undefined,
    skills:                parsed.skills,
    experience_years:      parsed.experience_years       ?? undefined,
    target_roles:          parsed.target_roles,
    seniority:             parsed.seniority              ?? undefined,
    current_or_recent_role:parsed.current_or_recent_role ?? undefined,
    domains:               parsed.domains,
    work_authorisation:    parsed.work_authorisation     ?? undefined,
    work_history:          parsed.work_history,
    education:             parsed.education,
    certifications:        parsed.certifications,
    languages:             parsed.languages,
    raw_cv_text:           rawCvText,
  })

  // Generate embedding from CV text + skills (async, best-effort)
  embedProfileAsync(profile.id, rawCvText, parsed.skills).catch(e =>
    console.error('[profileService] embed failed:', e.message)
  )

  return { profile, parsed }
}

// ── Embed profile in background ───────────────────────────────────────────────

async function embedProfileAsync(
  profileId: string,
  rawCvText: string,
  skills: string[]
): Promise<void> {
  const text = `${rawCvText}\n\nSkills: ${skills.join(', ')}`.slice(0, 2000)
  const vecs = await embedTexts([text])
  if (!vecs || !vecs[0]) return

  const client: PoolClient = await pool.connect()
  try {
    await client.query(
      `UPDATE user_profiles SET embedding = $1 WHERE id = $2`,
      [`[${vecs[0].join(',')}]`, profileId]
    )
  } finally {
    client.release()
  }
}
