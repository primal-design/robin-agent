import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../lib/auth.js'
import { uploadCV, upsertProfile, getProfile, resetProfileData } from '../services/profileService.js'
import { extractTextFromFile } from '../services/cvExtractor.js'
import { getOrCreateTenantForEmail, generateTelegramConnectToken } from '../services/tenantProvisioner.js'

const router = Router()

// Resolve tenant_id from req.actor identity — auto-provisions a tenant for new emails
async function getTenantId(identity: string, autoCreate = false): Promise<string | null> {
  if (identity.startsWith('email:')) {
    const email = identity.slice(6)
    if (autoCreate) return getOrCreateTenantForEmail(email)
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    )
    return r.rows[0]?.id ?? null
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

// DELETE /profile — clear current candidate profile and dependent matches/documents
router.delete('/profile', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    await resetProfileData(tenantId)
    res.json({ ok: true, cleared: true })
  } catch (err) { next(err) }
})

// POST /profile/cv — upload CV (text, base64 PDF/DOCX, or image)
router.post('/profile/cv', requireAuth, async (req, res, next) => {
  try {
    const { cv_text, file_data, file_name, file_type } = req.body as {
      cv_text?:   string
      file_data?: string  // base64 encoded file
      file_name?: string
      file_type?: string  // mime type
    }

    let extractedText: string

    if (file_data && file_name) {
      // New path: binary file uploaded as base64
      const buf = Buffer.from(file_data, 'base64')
      extractedText = await extractTextFromFile(buf, file_name, file_type ?? '')
    } else if (cv_text) {
      extractedText = cv_text
    } else {
      return res.status(400).json({ error: 'provide file_data or cv_text' })
    }

    if (!extractedText || extractedText.trim().length < 50) {
      return res.status(400).json({ error: 'Could not extract text from CV — try a different format' })
    }

    const tenantId = await getTenantId(req.actor!.phone, true)  // auto-create tenant on CV upload
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const { profile, parsed } = await uploadCV(tenantId, extractedText)
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

// GET /profile/telegram-connect — get a one-time token to connect Telegram
router.get('/profile/telegram-connect', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone, true)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const token   = await generateTelegramConnectToken(tenantId)
    const botName = process.env.TELEGRAM_BOT_USERNAME || 'fen_ai_bot'
    res.json({
      token,
      instructions: `Open Telegram and send this message to @${botName}:\n/connect ${token}`,
      deep_link:    `https://t.me/${botName}?start=connect_${token}`,
    })
  } catch (err) { next(err) }
})

// POST /profile/cv/debug — extract + parse CV without saving, returns raw parse result
router.post('/profile/cv/debug', requireAuth, async (req, res, next) => {
  try {
    const { cv_text, file_data, file_name, file_type } = req.body as {
      cv_text?:   string
      file_data?: string
      file_name?: string
      file_type?: string
    }

    let extractedText: string

    if (file_data && file_name) {
      const buf = Buffer.from(file_data, 'base64')
      extractedText = await extractTextFromFile(buf, file_name, file_type ?? '')
    } else if (cv_text) {
      extractedText = cv_text
    } else {
      return res.status(400).json({ error: 'provide file_data or cv_text' })
    }

    const { parseCV } = await import('../services/cvParser.js')
    const parsed = await parseCV(extractedText)

    res.json({
      extracted_text_length: extractedText.length,
      extracted_text_preview: extractedText.slice(0, 500),
      parsed,
    })
  } catch (err) { next(err) }
})

export default router
