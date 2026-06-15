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
  url.searchParams.set('keywords',      keywords)
  url.searchParams.set('locationName',  'uk')
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

// ── CV-Library ────────────────────────────────────────────────────────────────

async function fetchCVLibrary(keywords: string): Promise<NormalisedJob[]> {
  const apiKey = process.env.CV_LIBRARY_API_KEY
  if (!apiKey) {
    console.warn('[jobFetcher] CV_LIBRARY_API_KEY not set — skipping')
    return []
  }

  const url = new URL('https://www.cv-library.co.uk/api/jobs')
  url.searchParams.set('q',       keywords)
  url.searchParams.set('geo',     'uk')
  url.searchParams.set('per_page','100')
  url.searchParams.set('key',     apiKey)

  const r = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`CV-Library ${r.status}: ${await r.text().then(t => t.slice(0, 200))}`)

  const data = await r.json() as { jobs?: CVLibraryJob[] } | CVLibraryJob[]
  const jobs  = Array.isArray(data) ? data : (data.jobs ?? [])

  return jobs.map(j => ({
    source:          'cv_library',
    external_id:     String(j.id),
    title:           j.title,
    company:         j.company ?? null,
    location:        j.location ?? null,
    country:         'GB',
    salary_min:      j.salary_from ? Math.round(j.salary_from) : null,
    salary_max:      j.salary_to   ? Math.round(j.salary_to)   : null,
    currency:        'GBP',
    employment_type: j.type ?? null,
    remote_type:     detectRemote(j.title + ' ' + (j.description ?? '')),
    description:     j.description ?? null,
    url:             j.url ?? null,
    posted_at:       j.date ?? null,
    raw_payload:     j,
  }))
}

interface CVLibraryJob {
  id:           number | string
  title:        string
  company?:     string
  location?:    string
  salary_from?: number
  salary_to?:   number
  type?:        string
  description?: string
  url?:         string
  date?:        string
}

// ── Totaljobs RSS ────────────────────────────────────────────────────────────

async function fetchTotaljobs(keywords: string): Promise<NormalisedJob[]> {
  const encoded = encodeURIComponent(keywords)
  const feedUrl = `https://www.totaljobs.com/jobs/${encoded}/in-united-kingdom?JobType=4&salary=0&distance=15&radius=0&btnSubmit=Search&action=facet_search&rss=1`

  const r = await fetch(feedUrl, {
    headers: { 'User-Agent': 'FENJobAgent/1.0 (+https://fen.app)' },
  })
  if (!r.ok) throw new Error(`Totaljobs RSS ${r.status}`)

  const xml  = await r.text()
  const jobs = parseRssItems(xml, 'totaljobs')
  return jobs
}

// ── Guardian Jobs RSS ─────────────────────────────────────────────────────────

async function fetchGuardianJobs(keywords: string): Promise<NormalisedJob[]> {
  const encoded = encodeURIComponent(keywords)
  const feedUrl = `https://jobs.theguardian.com/jobs/${encoded}/?rss=1`

  const r = await fetch(feedUrl, {
    headers: { 'User-Agent': 'FENJobAgent/1.0 (+https://fen.app)' },
  })
  if (!r.ok) throw new Error(`Guardian Jobs RSS ${r.status}`)

  const xml  = await r.text()
  const jobs = parseRssItems(xml, 'guardian_jobs')
  return jobs
}

// ── NHS Jobs ─────────────────────────────────────────────────────────────────

async function fetchNHSJobs(keywords: string): Promise<NormalisedJob[]> {
  const url = new URL('https://www.jobs.nhs.uk/api/v1/search')
  url.searchParams.set('keyword',  keywords)
  url.searchParams.set('language', 'en')
  url.searchParams.set('size',     '100')

  const r = await fetch(url.toString(), {
    headers: { Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`NHS Jobs ${r.status}: ${await r.text().then(t => t.slice(0, 200))}`)

  const data = await r.json() as { data?: NHSJob[] }
  const jobs = data.data ?? []

  return jobs.map(j => ({
    source:          'nhs_jobs',
    external_id:     j.id ?? j.jobReference ?? String(Math.random()),
    title:           j.jobTitle ?? j.title ?? 'NHS Role',
    company:         j.employerName ?? 'NHS',
    location:        j.location ?? null,
    country:         'GB',
    salary_min:      j.salaryFrom ? Math.round(j.salaryFrom) : null,
    salary_max:      j.salaryTo   ? Math.round(j.salaryTo)   : null,
    currency:        'GBP',
    employment_type: j.contractType ?? null,
    remote_type:     null,
    description:     j.jobOverview ?? null,
    url:             j.jobUrl ?? `https://www.jobs.nhs.uk/candidate/jobadvert/${j.id}`,
    posted_at:       j.closingDate ?? null,
    raw_payload:     j,
  }))
}

interface NHSJob {
  id?:            string
  jobReference?:  string
  jobTitle?:      string
  title?:         string
  employerName?:  string
  location?:      string
  salaryFrom?:    number
  salaryTo?:      number
  contractType?:  string
  jobOverview?:   string
  jobUrl?:        string
  closingDate?:   string
}

// ── Minimal RSS parser (no external dependency) ───────────────────────────────

function parseRssItems(xml: string, source: string): NormalisedJob[] {
  const items: NormalisedJob[] = []

  const itemRegex = /<item>([\s\S]*?)<\/item>/g
  let match: RegExpExecArray | null

  while ((match = itemRegex.exec(xml)) !== null) {
    const item = match[1]

    const get = (tag: string): string | null => {
      const m = item.match(new RegExp(`<${tag}(?:[^>]*)?><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>|<${tag}(?:[^>]*?)>([\\s\\S]*?)<\\/${tag}>`))
      const val = m?.[1] ?? m?.[2] ?? null
      return val ? val.trim() : null
    }

    const title = get('title')
    if (!title) continue

    const link        = get('link') ?? get('guid') ?? null
    const description = get('description')
    const pubDate     = get('pubDate')
    const company     = get('company') ?? get('author') ?? null
    const location    = get('location') ?? null

    // Try to parse salary from description
    let salary_min: number | null = null
    let salary_max: number | null = null
    if (description) {
      const salaryMatch = description.match(/£([\d,]+)\s*[-–to]+\s*£([\d,]+)/i)
      if (salaryMatch) {
        salary_min = parseInt(salaryMatch[1].replace(/,/g, ''), 10)
        salary_max = parseInt(salaryMatch[2].replace(/,/g, ''), 10)
      }
    }

    // Derive a stable external_id from the URL or title+pubDate
    const external_id = link
      ? link.replace(/[^a-zA-Z0-9]/g, '').slice(-40)
      : `${title.slice(0, 20)}-${pubDate ?? Date.now()}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 40)

    items.push({
      source,
      external_id,
      title,
      company,
      location,
      country:         'GB',
      salary_min,
      salary_max,
      currency:        'GBP',
      employment_type: null,
      remote_type:     detectRemote(title + ' ' + (description ?? '')),
      description:     description ? description.replace(/<[^>]+>/g, '').slice(0, 3000) : null,
      url:             link,
      posted_at:       pubDate ?? null,
      raw_payload:     { title, link, description, pubDate, company, location },
    })
  }

  return items
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
    { name: 'adzuna', fn: () => fetchAdzuna(keywords) },
    { name: 'reed',   fn: () => fetchReed(keywords) },
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
