import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../lib/auth.js'
import { getProfile } from '../services/profileService.js'
import { reviewCV } from '../services/cvReviewer.js'

const router = Router()

async function getTenantId(identity: string): Promise<string | null> {
  const email = identity.startsWith('email:') ? identity.slice(6) : null
  if (!email) return null
  const r = await pool.query<{ id: string }>(`SELECT id FROM tenants WHERE LOWER(email)=LOWER($1) LIMIT 1`, [email])
  return r.rows[0]?.id ?? null
}

// GET /cv/review — run both AI reviewers against stored CV
router.get('/cv/review', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const profile = await getProfile(tenantId)
    if (!profile?.raw_cv_text) {
      return res.status(404).json({ error: 'no_cv', message: 'Upload a CV first' })
    }

    const jobTitle = profile.headline ?? undefined
    const feedback = await reviewCV(profile.raw_cv_text, jobTitle)
    res.json(feedback)
  } catch (err) { next(err) }
})

export default router
