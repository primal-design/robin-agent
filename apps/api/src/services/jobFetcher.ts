import { pool } from '../db/pool.js'
import { embedTexts } from '../lib/embed.js'
import { env } from '../config/env.js'

// ── Types ─────────────────────────────────────────────────────────────────────

interface NormalisedJob {
  source:          string
  external_id:     string
  title:           string
  company:         string | null
  location:        string | null
  country:         string
  salary_min:      number | null
  salary_max:      number | null
  currency:        string
  employment_type: string | null
  remote_type:     string | null
  description:     string | null
  url:             string | null
  posted_at:       string | null
  raw_payload:     object
}

// ── Adzuna ────────────────────────────────────────────────────────────────────

async function fetchAdzuna(keywords: string, resultsPerPage = 50): Promise<NormalisedJob[]> {
  const appId  = process.env.ADZUNA_APP_ID
  const appKey = process.env.ADZUNA_APP_KEY
  if (!appId || !appKey) {
    console.warn('[jobFetcher] ADZUNA_APP_ID / ADZUNA_APP_KEY not set — skipping')
    return []
  }

  const url = new URL('https://api.adzuna.com/v1/api/jobs/gb/search/1')
  url.searchParams.set('app_id',        appId)
  url.searchParams.set('app_key',       appKey)
  url.searchParams.set('results_per_page', String(resultsPerPage))
  url.searchParams.set('what',          keywords)
  url.searchParams.set('content-type',  'application/json')

  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`Adzuna ${r.status}: ${await r.text().then(t => t.slice(0, 200))}`)

  const data = await r.json() as { results: AdzunaJob[] }

  return (data.results ?? []).map(j => ({
    source:          'adzuna',
    external_id:     String(j.id),
    title:           j.title,
    company:         j.company?.display_name ?? null,
    location:        j.location?.display_name ?? null,
    country:         'GB',
    salary_min:      j.salary_min ? Math.round(j.salary_min) : null,
    salary_max:      j.salary_max ? Math.round(j.salary_max) : null,
    currency:        'GBP',
    employment_type: j.contract_type ?? null,
    remote_type:     detectRemote(j.title + ' ' + (j.description ?? '')),
    description:     j.description ?? null,
    url:             j.redirect_url ?? null,
    posted_at:       j.created ?? null,
    raw_payload:     j,
  }))
}

interface AdzunaJob {
  id:           number
  title:        string
  description?: string
  created?:     string
  redirect_url?:string
  salary_min?:  number
  salary_max?:  number
  contract_type?:string
  company?:     { display_name: string }
  location?:    { display_name: string }
}

// ── Reed ─────────────────────────────────────────────────────────────────────

async function fetchReed(keywords: string, resultsPerPage = 100): Promise<NormalisedJob[]> {
  const apiKey = process.env.REED_API_KEY
  if (!apiKey) {
    console.warn('[jobFetcher] REED_API_KEY not set — skipping')
    return []
  }

  const url = new URL('https://www.reed.co.uk/api/1.0/search')
  url.searchParams.set('keywords',    keywords)
  url.searchParams.set('resultsToTake', String(resultsPerPage))

  const r = await fetch(url.toString(), {
    headers: {
      Authorization: 'Basic ' + Buffer.from(apiKey + ':').toString('base64'),
    },
  })
  if (!r.ok) throw new Error(`Reed ${r.status}: ${await r.text().then(t => t.slice(0, 200))}`)

  const data = await r.json() as { results: ReedJob[] }

  return (data.results ?? []).map(j => ({
    source:          'reed',
    external_id:     String(j.jobId),
    title:           j.jobTitle,
    company:         j.employerName ?? null,
    location:        j.locationName ?? null,
    country:         'GB',
    salary_min:      j.minimumSalary ? Math.round(j.minimumSalary) : null,
    salary_max:      j.maximumSalary ? Math.round(j.maximumSalary) : null,
    currency:        'GBP',
    employment_type: null,
    remote_type:     detectRemote(j.jobTitle + ' ' + (j.jobDescription ?? '')),
    description:     j.jobDescription ?? null,
    url:             j.jobUrl ?? null,
    posted_at:       j.date ?? null,
    raw_payload:     j,
  }))
}

interface ReedJob {
  jobId:          number
  jobTitle:       string
  employerName?:  string
  locationName?:  string
  minimumSalary?: number
  maximumSalary?: number
  jobDescription?:string
  jobUrl?:        string
  date?:          string
}

// ── Remotive (remote jobs only) ───────────────────────────────────────────────

async function fetchRemotive(category?: string): Promise<NormalisedJob[]> {
  const url = new URL('https://remotive.com/api/remote-jobs')
  if (category) url.searchParams.set('category', category)
  url.searchParams.set('limit', '100')

  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`Remotive ${r.status}`)

  const data = await r.json() as { jobs: RemotiveJob[] }

  return (data.jobs ?? []).map(j => ({
    source:          'remotive',
    external_id:     String(j.id),
    title:           j.title,
    company:         j.company_name ?? null,
    location:        j.candidate_required_location ?? 'Remote',
    country:         'REMOTE',
    salary_min:      null,
    salary_max:      null,
    currency:        'USD',
    employment_type: j.job_type ?? null,
    remote_type:     'remote',
    description:     j.description ?? null,
    url:             j.url ?? null,
    posted_at:       j.publication_date ?? null,
    raw_payload:     j,
  }))
}

interface RemotiveJob {
  id:                          number
  title:                       string
  company_name?:               string
  candidate_required_location?:string
  job_type?:                   string
  description?:                string
  url?:                        string
  publication_date?:           string
}

// ── Helper: detect remote type from text ─────────────────────────────────────

function detectRemote(text: string): 'remote' | 'hybrid' | 'onsite' | null {
  const lower = text.toLowerCase()
  if (lower.includes('fully remote') || lower.includes('100% remote') || lower.includes('work from home')) return 'remote'
  if (lower.includes('remote')) return 'remote'
  if (lower.includes('hybrid')) return 'hybrid'
  return null
}

// ── Store jobs + embed ────────────────────────────────────────────────────────

async function storeJobs(jobs: NormalisedJob[]): Promise<{ inserted: number }> {
  if (!jobs.length) return { inserted: 0 }

  let inserted = 0
  const client = await pool.connect()
  try {
    for (const j of jobs) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO jobs
           (source, external_id, title, company, location, country,
            salary_min, salary_max, currency, employment_type, remote_type,
            description, url, posted_at, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
         ON CONFLICT (source, external_id) DO NOTHING
         RETURNING id`,
        [
          j.source, j.external_id, j.title, j.company, j.location, j.country,
          j.salary_min, j.salary_max, j.currency, j.employment_type, j.remote_type,
          j.description ? j.description.slice(0, 5000) : null,
          j.url, j.posted_at, JSON.stringify(j.raw_payload),
        ]
      )
      if (r.rows[0]) inserted++
    }
  } finally {
    client.release()
  }

  // Embed new jobs in background (best-effort)
  embedNewJobs().catch(e => console.error('[jobFetcher] embed error:', e.message))

  return { inserted }
}

// ── Embed any jobs that have no embedding yet ─────────────────────────────────

export async function embedNewJobs(): Promise<void> {
  const r = await pool.query<{ id: string; title: string; description: string | null; skills: string | null }>(
    `SELECT id, title, description FROM jobs WHERE embedding IS NULL LIMIT 100`
  )
  if (!r.rows.length) return

  const texts = r.rows.map(j =>
    `${j.title}\n${(j.description ?? '').slice(0, 1500)}`
  )

  const vecs = await embedTexts(texts)
  if (!vecs) return

  const client = await pool.connect()
  try {
    for (let i = 0; i < r.rows.length; i++) {
      if (!vecs[i]) continue
      await client.query(
        `UPDATE jobs SET embedding = $1 WHERE id = $2`,
        [`[${vecs[i].join(',')}]`, r.rows[i].id]
      )
    }
  } finally {
    client.release()
  }
}

// ── Main: run all enabled sources ────────────────────────────────────────────

export async function fetchAllJobs(keywords = 'software engineer developer'): Promise<void> {
  const sources = [
    { name: 'adzuna',   fn: () => fetchAdzuna(keywords) },
    { name: 'reed',     fn: () => fetchReed(keywords) },
    { name: 'remotive', fn: () => fetchRemotive() },
  ]

  for (const source of sources) {
    const runRes = await pool.query<{ id: string }>(
      `INSERT INTO job_fetch_runs (source) VALUES ($1) RETURNING id`,
      [source.name]
    )
    const runId = runRes.rows[0].id

    try {
      const jobs = await source.fn()
      const { inserted } = await storeJobs(jobs)

      await pool.query(
        `UPDATE job_fetch_runs
         SET finished_at = now(), jobs_fetched = $1, jobs_new = $2, success = true
         WHERE id = $3`,
        [jobs.length, inserted, runId]
      )
      console.log(`[jobFetcher] ${source.name}: ${jobs.length} fetched, ${inserted} new`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await pool.query(
        `UPDATE job_fetch_runs
         SET finished_at = now(), success = false, error = $1
         WHERE id = $2`,
        [msg, runId]
      )
      console.error(`[jobFetcher] ${source.name} failed:`, msg)
    }
  }
}
