import type { PoolClient } from 'pg'
import { pool } from '../db/pool.js'
import { parseCV } from './cvParser.js'
import { embedTexts } from '../lib/embed.js'

export interface UserProfile {
  id:                  string
  tenant_id:           string
  full_name:           string | null
  headline:            string | null
  location:            string | null
  target_roles:        string[]
  target_locations:    string[]
  min_salary:          number | null
  preferred_work_type: string
  skills:              string[]
  experience_years:    number | null
  raw_cv_text:         string | null
  created_at:          string
  updated_at:          string
}

// ── Get profile for tenant ────────────────────────────────────────────────────

export async function getProfile(tenantId: string): Promise<UserProfile | null> {
  const r = await pool.query<UserProfile>(
    `SELECT id, tenant_id, full_name, headline, location,
            target_roles, target_locations, min_salary,
            preferred_work_type, skills, experience_years,
            raw_cv_text, created_at, updated_at
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
       SET full_name           = COALESCE($1, full_name),
           headline            = COALESCE($2, headline),
           location            = COALESCE($3, location),
           target_roles        = COALESCE($4, target_roles),
           target_locations    = COALESCE($5, target_locations),
           min_salary          = COALESCE($6, min_salary),
           preferred_work_type = COALESCE($7, preferred_work_type),
           skills              = COALESCE($8, skills),
           experience_years    = COALESCE($9, experience_years),
           raw_cv_text         = COALESCE($10, raw_cv_text),
           updated_at          = now()
       WHERE id = $11
       RETURNING id, tenant_id, full_name, headline, location,
                 target_roles, target_locations, min_salary,
                 preferred_work_type, skills, experience_years,
                 raw_cv_text, created_at, updated_at`,
      [
        params.full_name        ?? null,
        params.headline         ?? null,
        params.location         ?? null,
        params.target_roles     ?? null,
        params.target_locations ?? null,
        params.min_salary       ?? null,
        params.preferred_work_type ?? null,
        params.skills           ?? null,
        params.experience_years ?? null,
        params.raw_cv_text      ?? null,
        existing.id,
      ]
    )
    return r.rows[0]
  }

  const r = await pool.query<UserProfile>(
    `INSERT INTO user_profiles
       (tenant_id, full_name, headline, location, target_roles, target_locations,
        min_salary, preferred_work_type, skills, experience_years, raw_cv_text)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, tenant_id, full_name, headline, location,
               target_roles, target_locations, min_salary,
               preferred_work_type, skills, experience_years,
               raw_cv_text, created_at, updated_at`,
    [
      tenantId,
      params.full_name           ?? null,
      params.headline            ?? null,
      params.location            ?? null,
      params.target_roles        ?? [],
      params.target_locations    ?? [],
      params.min_salary          ?? null,
      params.preferred_work_type ?? 'any',
      params.skills              ?? [],
      params.experience_years    ?? null,
      params.raw_cv_text         ?? null,
    ]
  )
  return r.rows[0]
}

// ── Upload CV: parse + embed + upsert ─────────────────────────────────────────

export async function uploadCV(
  tenantId: string,
  rawCvText: string
): Promise<{ profile: UserProfile; parsed: Awaited<ReturnType<typeof parseCV>> }> {
  // Parse CV fields with LLM
  const parsed = await parseCV(rawCvText)

  // Save profile with parsed fields
  const profile = await upsertProfile(tenantId, {
    full_name:        parsed.full_name        ?? undefined,
    headline:         parsed.headline         ?? undefined,
    location:         parsed.location         ?? undefined,
    skills:           parsed.skills.length    ? parsed.skills           : undefined,
    experience_years: parsed.experience_years ?? undefined,
    target_roles:     parsed.target_roles.length ? parsed.target_roles  : undefined,
    raw_cv_text:      rawCvText,
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
