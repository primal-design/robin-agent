import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../lib/auth.js'
import { uploadCV, upsertProfile, getProfile } from '../services/profileService.js'

const router = Router()

// Resolve tenant_id from req.actor identity
async function getTenantId(identity: string): Promise<string | null> {
  if (identity.startsWith('email:')) {
    const email = identity.slice(6)
    const r = await pool.query(
      `SELECT t.id FROM tenants t
       JOIN waitlist w ON LOWER(w.email) = LOWER($1)
       LIMIT 1`,
      [email]
    )
    // Fallback to default tenant
    const defaultId = process.env.DEFAULT_TENANT_ID
    return r.rows[0]?.id ?? defaultId ?? null
  }
  const r = await pool.query(
    `SELECT m.tenant_id FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE u.phone_e164 = $1 LIMIT 1`,
    [identity]
  )
  return r.rows[0]?.tenant_id ?? null
}

// GET /profile
router.get('/profile', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const profile = await getProfile(tenantId)
    res.json(profile ?? null)
  } catch (err) { next(err) }
})

// POST /profile/cv — upload raw CV text, parse + embed
router.post('/profile/cv', requireAuth, async (req, res, next) => {
  try {
    const { cv_text } = req.body as { cv_text?: string }
    if (!cv_text || cv_text.trim().length < 50) {
      return res.status(400).json({ error: 'cv_text must be at least 50 characters' })
    }

    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const { profile, parsed } = await uploadCV(tenantId, cv_text)
    res.status(201).json({ profile, parsed })
  } catch (err) { next(err) }
})

// PATCH /profile — update preferences manually
router.patch('/profile', requireAuth, async (req, res, next) => {
  try {
    const {
      full_name, headline, location,
      target_roles, target_locations,
      min_salary, preferred_work_type,
      skills, experience_years,
    } = req.body as Record<string, unknown>

    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const profile = await upsertProfile(tenantId, {
      full_name:           typeof full_name          === 'string'  ? full_name           : undefined,
      headline:            typeof headline            === 'string'  ? headline            : undefined,
      location:            typeof location            === 'string'  ? location            : undefined,
      target_roles:        Array.isArray(target_roles)             ? target_roles         : undefined,
      target_locations:    Array.isArray(target_locations)         ? target_locations     : undefined,
      min_salary:          typeof min_salary          === 'number'  ? min_salary          : undefined,
      preferred_work_type: typeof preferred_work_type === 'string'  ? preferred_work_type : undefined,
      skills:              Array.isArray(skills)                    ? skills              : undefined,
      experience_years:    typeof experience_years    === 'number'  ? experience_years    : undefined,
    })

    res.json(profile)
  } catch (err) { next(err) }
})

export default router
