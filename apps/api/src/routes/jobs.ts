import { Router } from 'express'
import { pool } from '../db/pool.js'
import { fetchAllJobs } from '../services/jobFetcher.js'
import { matchJobsForProfile } from '../services/jobMatcher.js'
import { getProfile } from '../services/profileService.js'

const router = Router()

// POST /jobs/fetch-and-match — admin trigger to fetch jobs + run matching
router.post('/jobs/fetch-and-match', async (req, res, next) => {
  const secret = req.headers['x-admin-secret'] || req.query.secret
  if (secret !== (process.env.ADMIN_SECRET || 'robin-admin-2026!xK9')) {
    return res.status(401).json({ error: 'unauthorized' })
  }
  try {
    res.json({ ok: true, message: 'Job fetch + match started in background' })
    // Run async after responding
    ;(async () => {
      try {
        const fetchResult = await fetchAllJobs()
        console.log('[admin] Jobs fetched:', fetchResult)
        const tenantId = process.env.DEFAULT_TENANT_ID
        if (tenantId) {
          // Set RLS tenant context
          await pool.query(`SET app.current_tenant = '${tenantId}'`)
          const profile = await getProfile(tenantId)
          console.log('[admin] Profile found:', profile?.id)
          if (profile) {
            const matchResult = await matchJobsForProfile(tenantId, profile.id, profile)
            console.log('[admin] Matching done:', matchResult)
          } else {
            console.warn('[admin] No profile found for tenant', tenantId)
          }
        }
      } catch (err) {
        console.error('[admin] fetch-and-match error:', err)
      }
    })()
  } catch (err) { next(err) }
})

// GET /jobs — public job board (no auth required)
router.get('/jobs', async (req, res, next) => {
  try {
    const {
      q,
      location,
      remote,
      salary_min,
      source,
      page = '1',
      limit = '20',
    } = req.query as Record<string, string>

    const pageNum  = Math.max(1, parseInt(page, 10)  || 1)
    const limitNum = Math.min(50, parseInt(limit, 10) || 20)
    const offset   = (pageNum - 1) * limitNum

    const conditions: string[] = ['is_active = true']
    const params: unknown[]    = []

    if (q) {
      params.push(`%${q}%`)
      conditions.push(`(title ILIKE $${params.length} OR company ILIKE $${params.length} OR description ILIKE $${params.length})`)
    }
    if (location) {
      params.push(`%${location}%`)
      conditions.push(`location ILIKE $${params.length}`)
    }
    if (remote === 'true') {
      conditions.push(`remote_type = 'remote'`)
    }
    if (salary_min) {
      params.push(parseInt(salary_min, 10))
      conditions.push(`(salary_max IS NULL OR salary_max >= $${params.length})`)
    }
    if (source) {
      params.push(source)
      conditions.push(`source = $${params.length}`)
    }

    const where = conditions.join(' AND ')

    params.push(limitNum)
    params.push(offset)

    const r = await pool.query(
      `SELECT id, source, title, company, location, country,
              salary_min, salary_max, currency, employment_type,
              remote_type, seniority, url, posted_at, fetched_at
       FROM jobs
       WHERE ${where}
       ORDER BY posted_at DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )

    const countRes = await pool.query(
      `SELECT COUNT(*) AS total FROM jobs WHERE ${where}`,
      params.slice(0, params.length - 2)
    )

    res.json({
      jobs:  r.rows,
      total: Number(countRes.rows[0].total),
      page:  pageNum,
      limit: limitNum,
    })
  } catch (err) { next(err) }
})

// GET /jobs/:id — public job detail
router.get('/jobs/:id', async (req, res, next) => {
  try {
    const r = await pool.query(
      `SELECT id, source, title, company, location, country,
              salary_min, salary_max, currency, employment_type,
              remote_type, seniority, description, url, posted_at, fetched_at
       FROM jobs
       WHERE id = $1 AND is_active = true`,
      [req.params.id]
    )
    if (!r.rows[0]) return res.status(404).json({ error: 'not_found' })
    res.json(r.rows[0])
  } catch (err) { next(err) }
})

export default router
