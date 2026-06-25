import { Router } from 'express'
import { pool } from '../db/pool.js'
import { requireAuth } from '../lib/auth.js'
import { getProfile } from '../services/profileService.js'
import { matchJobsForProfile, getTopMatches } from '../services/jobMatcher.js'
import { tailorForApplication } from '../services/documentTailor.js'
import { buildCvDocx } from '../services/cvExporter.js'

const router = Router()

async function getTenantId(identity: string): Promise<string | null> {
  if (identity.startsWith('email:')) {
    const email = identity.slice(6)
    const r = await pool.query<{ id: string }>(
      `SELECT id FROM tenants WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    )
    return r.rows[0]?.id ?? process.env.DEFAULT_TENANT_ID ?? null
  }
  const r = await pool.query(
    `SELECT m.tenant_id FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE u.phone_e164 = $1 LIMIT 1`,
    [identity]
  )
  return r.rows[0]?.tenant_id ?? null
}

// GET /matches — get top scored matches for the user's profile
router.get('/matches', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const profile = await getProfile(tenantId)
    if (!profile) return res.status(404).json({ error: 'profile_not_found', hint: 'Upload a CV first' })

    const limit    = Math.min(50, parseInt(req.query.limit as string || '20', 10))
    const minScore = parseInt(req.query.min_score as string || '40', 10)

    const matches = await getTopMatches(tenantId, profile.id, limit, minScore)
    res.json({ matches, profile_id: profile.id })
  } catch (err) { next(err) }
})

// POST /matches/run — trigger matching for the current user (on-demand)
router.post('/matches/run', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const profile = await getProfile(tenantId)
    if (!profile) return res.status(404).json({ error: 'profile_not_found', hint: 'Upload a CV first' })

    const result = await matchJobsForProfile(tenantId, profile.id, profile)
    res.json({ ok: true, ...result })
  } catch (err) { next(err) }
})

// PATCH /matches/:id/feedback — user marks a match as interested/skip/not_relevant
router.patch('/matches/:id/feedback', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const { feedback } = req.body as { feedback?: string }
    const allowed = ['interested', 'skip', 'not_relevant']
    if (!feedback || !allowed.includes(feedback)) {
      return res.status(400).json({ error: `feedback must be one of: ${allowed.join(', ')}` })
    }

    const r = await pool.query(
      `UPDATE job_matches SET user_feedback = $1
       WHERE id = $2 AND tenant_id = $3
       RETURNING id, job_id, suitability_score, user_feedback`,
      [feedback, req.params.id, tenantId]
    )
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' })

    // If interested → create an application entry
    if (feedback === 'interested') {
      const match = r.rows[0]
      const profile = await getProfile(tenantId)
      if (profile) {
        await pool.query(
          `INSERT INTO applications
             (tenant_id, profile_id, job_id, status, match_score)
           VALUES ($1, $2, $3, 'interested', $4)
           ON CONFLICT DO NOTHING`,
          [tenantId, profile.id, match.job_id, match.suitability_score]
        )
      }
    }

    res.json(r.rows[0])
  } catch (err) { next(err) }
})

// GET /applications/:id/events — timeline for one application
router.get('/applications/:id/events', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })
    const r = await pool.query(
      `SELECT event_type, note, created_at FROM application_events
       WHERE application_id = $1 AND tenant_id = $2
       ORDER BY created_at ASC`,
      [req.params.id, tenantId]
    )
    res.json(r.rows)
  } catch (err) { next(err) }
})

// GET /applications — get user's application pipeline
router.get('/applications', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const r = await pool.query(
      `SELECT a.id, a.status, a.match_score, a.applying_email,
              a.approved_at, a.applied_at, a.last_update_at, a.created_at,
              j.title, j.company, j.location, j.salary_min, j.salary_max,
              j.remote_type, j.url
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       WHERE a.tenant_id = $1
       ORDER BY a.created_at DESC`,
      [tenantId]
    )
    res.json(r.rows)
  } catch (err) { next(err) }
})

// POST /applications/:id/tailor — generate tailored CV + cover letter
router.post('/applications/:id/tailor', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    // Mark as drafting
    await pool.query(
      `UPDATE applications SET status = 'drafting', last_update_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]
    )
    await pool.query(
      `INSERT INTO application_events (tenant_id, application_id, event_type)
       VALUES ($1, $2, 'DRAFTING_STARTED')`,
      [tenantId, req.params.id]
    )

    const docs = await tailorForApplication(tenantId, req.params.id)
    res.json({
      ok:              true,
      resume_id:       docs.resumeId,
      cover_letter_id: docs.coverLetterId,
      cv_preview:      docs.cvContent.slice(0, 500),
      cl_preview:      docs.clContent.slice(0, 300),
    })
  } catch (err) { next(err) }
})

// GET /applications/:id/documents — get latest tailored CV + cover letter
router.get('/applications/:id/documents', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const r = await pool.query(
      `SELECT r.content AS cv_content, r.version AS cv_version,
              cl.content AS cl_content, cl.version AS cl_version
       FROM applications a
       LEFT JOIN resumes       r  ON r.id  = a.tailored_cv_id
       LEFT JOIN cover_letters cl ON cl.id = a.cover_letter_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [req.params.id, tenantId]
    )
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' })
    res.json(r.rows[0])
  } catch (err) { next(err) }
})

// GET /applications/:id/cv.docx — download tailored CV as Word document
router.get('/applications/:id/cv.docx', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const r = await pool.query(
      `SELECT r.content AS cv_content, j.title, j.company,
              p.full_name, p.email, p.phone, p.location
       FROM applications a
       JOIN jobs j ON j.id = a.job_id
       JOIN profiles p ON p.tenant_id = a.tenant_id
       LEFT JOIN resumes r ON r.id = a.tailored_cv_id
       WHERE a.id = $1 AND a.tenant_id = $2`,
      [req.params.id, tenantId]
    )
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' })
    const row = r.rows[0]
    if (!row.cv_content) return res.status(404).json({ error: 'cv_not_tailored_yet' })

    const buf = await buildCvDocx({
      cvContent: row.cv_content,
      fullName:  row.full_name || 'Applicant',
      email:     row.email,
      phone:     row.phone,
      location:  row.location,
    })

    const filename = `CV_${(row.company || 'Application').replace(/\s+/g, '_')}.docx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    res.send(buf)
  } catch (err) { next(err) }
})

// PATCH /applications/:id/status — update application status
router.patch('/applications/:id/status', requireAuth, async (req, res, next) => {
  try {
    const tenantId = await getTenantId(req.actor!.phone)
    if (!tenantId) return res.status(403).json({ error: 'no_tenant' })

    const { status } = req.body as { status?: string }
    const validStatuses = [
      'matched','interested','drafting','draft_ready',
      'approved','applied','interview','assessment',
      'offer','rejected','withdrawn',
    ]
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: 'invalid status' })
    }

    const r = await pool.query(
      `UPDATE applications
       SET status = $1,
           approved_at    = CASE WHEN $1 = 'approved' THEN now() ELSE approved_at END,
           applied_at     = CASE WHEN $1 = 'applied'  THEN now() ELSE applied_at  END,
           last_update_at = now()
       WHERE id = $2 AND tenant_id = $3
       RETURNING *`,
      [status, req.params.id, tenantId]
    )
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' })

    // Log event
    await pool.query(
      `INSERT INTO application_events (tenant_id, application_id, event_type)
       VALUES ($1, $2, $3)`,
      [tenantId, req.params.id, status.toUpperCase().replace(/-/g, '_')]
    )

    res.json(r.rows[0])
  } catch (err) { next(err) }
})

export default router
