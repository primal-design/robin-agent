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
    console.warn('[jobFetcher] CV_LIBRARY_API_KEY not set — skipping cv_library')
    return []
  }

  const url = new URL('https://www.cv-library.co.uk/search-jobs-json')
  url.searchParams.set('q',                keywords)
  url.searchParams.set('geo',              'United Kingdom')
  url.searchParams.set('distance',         '500')
  url.searchParams.set('salarytype',       'annum')
  url.searchParams.set('limit',            '100')
  url.searchParams.set('order',            'date')
  url.searchParams.set('description_full', '1')
  url.searchParams.set('nohl',             '1')
  url.searchParams.set('key',              apiKey)

  const r = await fetch(url.toString())
  if (!r.ok) throw new Error(`CV-Library ${r.status}: ${await r.text().then(t => t.slice(0, 200))}`)

  const data = await r.json() as { jobs?: CVLibraryJob[]; total_entries?: number }

  return (data.jobs ?? []).map(j => {
    // Salary comes as "£40000 - £55000/annum" string — parse it
    let salary_min: number | null = null
    let salary_max: number | null = null
    if (j.salary) {
      const nums = j.salary.match(/[\d,]+/g)
      if (nums?.[0]) salary_min = parseInt(nums[0].replace(/,/g, ''), 10)
      if (nums?.[1]) salary_max = parseInt(nums[1].replace(/,/g, ''), 10)
    }

    const fullUrl = j.url
      ? (j.url.startsWith('http') ? j.url : `https://www.cv-library.co.uk${j.url}`)
      : null

    return {
      source:          'cv_library',
      external_id:     String(j.id),
      title:           j.title,
      company:         j.agency?.title ?? null,
      location:        j.location ?? null,
      country:         'GB',
      salary_min,
      salary_max,
      currency:        'GBP',
      employment_type: j.type?.[0] ?? null,
      remote_type:     detectRemote(j.title + ' ' + (j.description ?? '')),
      description:     j.description ?? null,
      url:             fullUrl,
      posted_at:       j.posted ?? null,
      raw_payload:     j,
    }
  })
}

interface CVLibraryJob {
  id:           string
  title:        string
  description?: string
  location?:    string
  salary?:      string
  type?:        string[]
  url?:         string
  posted?:      string
  expiry_date?: string
  agency?:      { title: string; type: string; url: string }
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

// ── Greenhouse ────────────────────────────────────────────────────────────────
// Public job board API — no key needed. One request per company.

const GREENHOUSE_COMPANIES: string[] = [
  // UK Fintech / Banking
  'monzo', 'revolut', 'wise', 'starlingbank', 'oaknorth',
  'truelayer', 'modulr', 'railsr', 'form3', 'currencycloud',
  // UK Tech
  'deliveroo', 'gousto', 'cazoo', 'octopusenergy', 'bulb',
  'depop', 'farfetch', 'asos', 'trainline', 'skyscanner',
  'peakon', 'multiverse', 'improbable', 'tractable', 'cleo',
  // UK Scale-ups
  'yapily', 'coconut', 'marshmallow', 'zego', 'bought-by-many',
  'habito', 'cuvva', 'wealthsimple', 'plaid', 'checkout',
  // Global with strong UK presence
  'spotify', 'google', 'amazon', 'meta', 'apple',
  'palantir', 'datadog', 'snowflake', 'stripe', 'twilio',
]

async function fetchGreenhouse(): Promise<NormalisedJob[]> {
  const results: NormalisedJob[] = []

  for (const company of GREENHOUSE_COMPANIES) {
    try {
      const r = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${company}/jobs?content=true`,
        { headers: { Accept: 'application/json' } }
      )
      if (!r.ok) continue  // company slug invalid or no public board — skip silently

      const data = await r.json() as { jobs?: GreenhouseJob[] }

      for (const j of data.jobs ?? []) {
        // Filter to UK-relevant locations
        const loc = (j.location?.name ?? '').toLowerCase()
        const isUK = loc.includes('uk') || loc.includes('united kingdom') ||
                     loc.includes('london') || loc.includes('manchester') ||
                     loc.includes('edinburgh') || loc.includes('bristol') ||
                     loc.includes('remote') || loc === ''

        if (!isUK) continue

        results.push({
          source:          'greenhouse',
          external_id:     String(j.id),
          title:           j.title,
          company:         company.charAt(0).toUpperCase() + company.slice(1),
          location:        j.location?.name ?? null,
          country:         'GB',
          salary_min:      null,
          salary_max:      null,
          currency:        'GBP',
          employment_type: null,
          remote_type:     detectRemote(j.title + ' ' + (j.location?.name ?? '') + ' ' + (j.content ?? '')),
          description:     j.content ? j.content.replace(/<[^>]+>/g, '').slice(0, 5000) : null,
          url:             j.absolute_url ?? null,
          posted_at:       j.updated_at ?? null,
          raw_payload:     { id: j.id, title: j.title, company, location: j.location },
        })
      }

      // Small delay to avoid rate limiting across many companies
      await new Promise(r => setTimeout(r, 100))
    } catch {
      // Skip failed company silently
    }
  }

  return results
}

interface GreenhouseJob {
  id:           number
  title:        string
  content?:     string
  absolute_url?:string
  updated_at?:  string
  location?:    { name: string }
}

// ── Lever ─────────────────────────────────────────────────────────────────────
// Public posting API — no key needed. One request per company.

const LEVER_COMPANIES: string[] = [
  // UK Fintech
  'moneyboxapp', 'penfold', 'chip', 'ziglu', 'tickr',
  'lendable', 'iwoca', 'funding-circle', 'liberis', 'uncapped',
  // UK Tech
  'babylonhealth', 'healios', 'accurx', 'doctorcare', 'kry',
  'unmind', 'spill', 'oliva', 'kooth', 'ieso',
  // UK Scale-ups
  'bumble', 'hinge', 'smartpension', 'pensionbee', 'nutmeg',
  'moneyfarm', 'investengine', 'freetrade', 'trading212',
  // Global UK offices
  'figma', 'notion', 'linear', 'vercel', 'supabase',
  'netlify', 'cloudflare', 'hashicorp', 'confluent', 'dbt-labs',
]

async function fetchLever(): Promise<NormalisedJob[]> {
  const results: NormalisedJob[] = []

  for (const company of LEVER_COMPANIES) {
    try {
      const r = await fetch(
        `https://api.lever.co/v0/postings/${company}?mode=json&limit=50`,
        { headers: { Accept: 'application/json' } }
      )
      if (!r.ok) continue

      const data = await r.json() as LeverJob[]

      for (const j of Array.isArray(data) ? data : []) {
        const loc = (j.categories?.location ?? '').toLowerCase()
        const isUK = loc.includes('uk') || loc.includes('united kingdom') ||
                     loc.includes('london') || loc.includes('manchester') ||
                     loc.includes('remote') || loc === ''

        if (!isUK) continue

        const description = [
          j.descriptionPlain,
          j.lists?.map((l: { text: string; content: string }) => `${l.text}\n${l.content}`).join('\n'),
        ].filter(Boolean).join('\n').slice(0, 5000)

        results.push({
          source:          'lever',
          external_id:     j.id,
          title:           j.text,
          company:         company.charAt(0).toUpperCase() + company.slice(1),
          location:        j.categories?.location ?? null,
          country:         'GB',
          salary_min:      null,
          salary_max:      null,
          currency:        'GBP',
          employment_type: j.categories?.commitment ?? null,
          remote_type:     detectRemote(j.text + ' ' + (j.categories?.location ?? '')),
          description,
          url:             j.hostedUrl ?? null,
          posted_at:       j.createdAt ? new Date(j.createdAt).toISOString() : null,
          raw_payload:     { id: j.id, text: j.text, company, categories: j.categories },
        })
      }

      await new Promise(r => setTimeout(r, 100))
    } catch {
      // Skip failed company silently
    }
  }

  return results
}

interface LeverJob {
  id:                string
  text:              string
  hostedUrl?:        string
  descriptionPlain?: string
  createdAt?:        number
  lists?:            { text: string; content: string }[]
  categories?: {
    location?:   string
    commitment?: string
    team?:       string
  }
}

// ── SmartRecruiters ───────────────────────────────────────────────────────────
// Public jobs API — no key needed. One request per company.

const SMARTRECRUITERS_COMPANIES: string[] = [
  // Verified SmartRecruiters users (UK)
  'IKEA', 'Bosch', 'Zalando', 'Lidl', 'Aldi',
  'McDonald', 'KFC', 'Hilton', 'IHG', 'Marriott',
  'Siemens', 'Philips', 'Panasonic', 'Canon', 'Fujitsu',
  'Capita', 'Serco', 'G4S', 'Sodexo', 'Compass',
  'Hays', 'Adecco', 'ManpowerGroup', 'Randstad', 'PageGroup',
]

async function fetchSmartRecruiters(): Promise<NormalisedJob[]> {
  const results: NormalisedJob[] = []

  for (const company of SMARTRECRUITERS_COMPANIES) {
    try {
      const r = await fetch(
        `https://api.smartrecruiters.com/v1/companies/${company}/postings?limit=100`,
        { headers: { Accept: 'application/json' } }
      )
      if (!r.ok) continue

      const data = await r.json() as { content?: SmartRecruiterJob[] }

      for (const j of data.content ?? []) {
        const loc = (j.location?.city ?? '') + ' ' + (j.location?.country ?? '')
        const isUK = loc.toLowerCase().includes('uk') ||
                     loc.toLowerCase().includes('united kingdom') ||
                     loc.toLowerCase().includes('london') ||
                     loc.toLowerCase().includes('manchester') ||
                     loc.toLowerCase().includes('england') ||
                     (j.location?.remote ?? false)

        if (!isUK) continue

        results.push({
          source:          'smartrecruiters',
          external_id:     j.id,
          title:           j.name,
          company:         j.company?.name ?? company,
          location:        j.location?.city ?? null,
          country:         'GB',
          salary_min:      null,
          salary_max:      null,
          currency:        'GBP',
          employment_type: j.typeOfEmployment?.id ?? null,
          remote_type:     j.location?.remote ? 'remote' : detectRemote(j.name),
          description:     null,
          url:             `https://jobs.smartrecruiters.com/${company}/${j.id}`,
          posted_at:       j.releasedDate ?? null,
          raw_payload:     j,
        })
      }

      await new Promise(r => setTimeout(r, 100))
    } catch {
      // Skip silently
    }
  }

  return results
}

interface SmartRecruiterJob {
  id:                string
  name:              string
  releasedDate?:     string
  company?:          { name: string }
  location?:         { city?: string; country?: string; remote?: boolean }
  typeOfEmployment?: { id: string }
}

// ── Workable ──────────────────────────────────────────────────────────────────
// Public jobs API — no key needed per company subdomain.

const WORKABLE_COMPANIES: string[] = [
  // UK Recruitment agencies using Workable
  'tiger-recruitment', 'oakleaf-partnership', 'hr-inspire',
  'twenty-recruitment', 'networx', 'pertemps',
  // UK companies with active HR hiring
  'bulb', 'cleo', 'moneybox', 'habito', 'cuvva',
  'accurx', 'unmind', 'spill', 'oliva', 'kooth',
  'beamery', 'learnerbly', 'multiverse', 'corndel', 'decoded',
]

async function fetchWorkable(): Promise<NormalisedJob[]> {
  const results: NormalisedJob[] = []

  for (const company of WORKABLE_COMPANIES) {
    try {
      const r = await fetch(
        `https://apply.workable.com/api/v3/accounts/${company}/jobs`,
        { headers: { Accept: 'application/json' } }
      )
      if (!r.ok) continue

      const data = await r.json() as { results?: WorkableJob[] }

      for (const j of data.results ?? []) {
        const loc = (j.location?.city ?? '') + ' ' + (j.location?.country ?? '')
        const isUK = loc.toLowerCase().includes('uk') ||
                     loc.toLowerCase().includes('united kingdom') ||
                     loc.toLowerCase().includes('london') ||
                     loc.toLowerCase().includes('england') ||
                     (j.remote ?? false)

        if (!isUK) continue

        results.push({
          source:          'workable',
          external_id:     j.shortcode ?? j.id,
          title:           j.title,
          company:         company.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          location:        j.location?.city ?? null,
          country:         'GB',
          salary_min:      null,
          salary_max:      null,
          currency:        'GBP',
          employment_type: j.employment_type ?? null,
          remote_type:     j.remote ? 'remote' : detectRemote(j.title),
          description:     j.description?.replace(/<[^>]+>/g, '').slice(0, 5000) ?? null,
          url:             `https://apply.workable.com/${company}/j/${j.shortcode}`,
          posted_at:       j.published_on ?? null,
          raw_payload:     j,
        })
      }

      await new Promise(r => setTimeout(r, 100))
    } catch {
      // Skip silently
    }
  }

  return results
}

interface WorkableJob {
  id:               string
  shortcode?:       string
  title:            string
  description?:     string
  employment_type?: string
  remote?:          boolean
  published_on?:    string
  location?:        { city?: string; country?: string }
}

// ── Arbeitnow ─────────────────────────────────────────────────────────────────
// Completely free, no key, good UK remote + tech coverage

async function fetchArbeitnow(): Promise<NormalisedJob[]> {
  const r = await fetch(
    'https://www.arbeitnow.com/api/job-board-api?page=1',
    { headers: { Accept: 'application/json' } }
  )
  if (!r.ok) throw new Error(`Arbeitnow ${r.status}`)

  const data = await r.json() as { data?: ArbeitnowJob[] }

  return (data.data ?? [])
    .filter(j => {
      const loc = (j.location ?? '').toLowerCase()
      return loc.includes('uk') || loc.includes('united kingdom') ||
             loc.includes('london') || loc.includes('remote') || j.remote
    })
    .map(j => ({
      source:          'arbeitnow',
      external_id:     j.slug,
      title:           j.title,
      company:         j.company_name ?? null,
      location:        j.location ?? null,
      country:         j.remote ? 'REMOTE' : 'GB',
      salary_min:      null,
      salary_max:      null,
      currency:        'GBP',
      employment_type: j.job_types?.[0] ?? null,
      remote_type:     j.remote ? 'remote' : detectRemote(j.title + ' ' + (j.description ?? '')),
      description:     j.description?.slice(0, 5000) ?? null,
      url:             j.url ?? null,
      posted_at:       j.created_at ? new Date(j.created_at * 1000).toISOString() : null,
      raw_payload:     j,
    }))
}

interface ArbeitnowJob {
  slug:          string
  title:         string
  company_name?: string
  location?:     string
  remote:        boolean
  job_types?:    string[]
  description?:  string
  url?:          string
  created_at?:   number
}

// ── Monster UK RSS ───────────────────────────────────────────────────────────
// Free RSS, no key. Good UK recruiting/HR coverage.

async function fetchMonsterUK(keywords: string): Promise<NormalisedJob[]> {
  const searches = [
    { q: keywords, loc: 'London' },
    { q: 'recruiter talent acquisition', loc: 'London' },
    { q: 'HR recruitment consultant', loc: 'London' },
  ]

  const allJobs: NormalisedJob[] = []

  for (const s of searches) {
    const url = `https://www.monster.co.uk/jobs/rss?q=${encodeURIComponent(s.q)}&where=${encodeURIComponent(s.loc)}`
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'FENJobAgent/1.0 (+https://fen.app)', Accept: 'application/rss+xml,application/xml' },
      })
      if (!r.ok) continue

      const xml  = await r.text()
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? []

      for (const item of items) {
        const title   = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]?.trim()
                     ?? item.match(/<title>(.*?)<\/title>/)?.[1]?.trim() ?? ''
        const link    = item.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? ''
        const company = item.match(/<companyname><!\[CDATA\[(.*?)\]\]><\/companyname>/)?.[1]?.trim()
                     ?? item.match(/<dc:creator>(.*?)<\/dc:creator>/)?.[1]?.trim() ?? null
        const loc     = item.match(/<monsterjob:city>(.*?)<\/monsterjob:city>/)?.[1]?.trim() ?? s.loc
        const desc    = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]
                          ?.replace(/<[^>]+>/g, '').trim().slice(0, 5000) ?? null
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? null
        const guid    = item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1] ?? link

        if (!title || !link) continue

        allJobs.push({
          source:          'monster_uk',
          external_id:     guid,
          title,
          company,
          location:        loc,
          country:         'GB',
          salary_min:      null,
          salary_max:      null,
          currency:        'GBP',
          employment_type: null,
          remote_type:     detectRemote(title + ' ' + (desc ?? '')),
          description:     desc,
          url:             link,
          posted_at:       pubDate ? new Date(pubDate).toISOString() : null,
          raw_payload:     { title, link, company, loc },
        })
      }
      await new Promise(r => setTimeout(r, 400))
    } catch (err) {
      console.warn('[jobFetcher] Monster UK fetch failed:', err instanceof Error ? err.message : err)
    }
  }

  const seen = new Set<string>()
  return allJobs.filter(j => { if (seen.has(j.external_id)) return false; seen.add(j.external_id); return true })
}

// ── Guardian Jobs ─────────────────────────────────────────────────────────────
// Free API, requires key from jobs.theguardian.com/api

async function fetchGuardianJobsAPI(keywords: string): Promise<NormalisedJob[]> {
  const apiKey = process.env.GUARDIAN_JOBS_API_KEY
  if (!apiKey) {
    console.warn('[jobFetcher] GUARDIAN_JOBS_API_KEY not set — skipping')
    return []
  }

  const url = new URL('https://jobs.theguardian.com/api/1/jobs')
  url.searchParams.set('apiKey',   apiKey)
  url.searchParams.set('keywords', keywords)
  url.searchParams.set('locationName', 'London')
  url.searchParams.set('pageSize', '50')

  const r = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  if (!r.ok) throw new Error(`GuardianJobs ${r.status}: ${await r.text().then(t => t.slice(0, 200))}`)

  const data = await r.json() as { jobs?: GuardianJob[] }

  return (data.jobs ?? []).map(j => ({
    source:          'guardian_jobs',
    external_id:     String(j.id),
    title:           j.jobTitle,
    company:         j.recruiterName ?? null,
    location:        j.locationName ?? 'London',
    country:         'GB',
    salary_min:      j.salaryMinimum ?? null,
    salary_max:      j.salaryMaximum ?? null,
    currency:        'GBP',
    employment_type: j.contractType ?? null,
    remote_type:     detectRemote(j.jobTitle + ' ' + (j.locationName ?? '')),
    description:     j.shortDescription ?? null,
    url:             j.jobUrl ?? null,
    posted_at:       j.postedDate ?? null,
    raw_payload:     j,
  }))
}

interface GuardianJob {
  id:               number
  jobTitle:         string
  recruiterName?:   string
  locationName?:    string
  salaryMinimum?:   number
  salaryMaximum?:   number
  contractType?:    string
  shortDescription?:string
  jobUrl?:          string
  postedDate?:      string
}

// ── Indeed UK RSS ─────────────────────────────────────────────────────────────
// Free RSS feed, no key. Searches Indeed UK for specific keywords + location.

async function fetchIndeedUK(keywords: string): Promise<NormalisedJob[]> {
  const searches = [
    { q: keywords, l: 'London' },
    { q: 'recruiter talent acquisition', l: 'London' },
    { q: 'HR recruitment sourcing', l: 'London' },
  ]

  const allJobs: NormalisedJob[] = []

  for (const s of searches) {
    const url = `https://www.indeed.co.uk/rss?q=${encodeURIComponent(s.q)}&l=${encodeURIComponent(s.l)}&radius=10&sort=date`
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'FENJobAgent/1.0 (+https://fen.app)', Accept: 'application/rss+xml,application/xml' },
      })
      if (!r.ok) continue

      const xml = await r.text()

      // Parse RSS items with regex (no xml parser dependency)
      const items = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? []

      for (const item of items) {
        const title    = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1]?.trim() ?? ''
        const link     = item.match(/<link>(.*?)<\/link>/)?.[1]?.trim() ?? ''
        const company  = item.match(/<source[^>]*>(.*?)<\/source>/)?.[1]?.trim() ?? null
        const location = item.match(/<indeed:city>(.*?)<\/indeed:city>/)?.[1]?.trim()
                      ?? item.match(/<indeed:state>(.*?)<\/indeed:state>/)?.[1]?.trim()
                      ?? s.l
        const salMin   = item.match(/<indeed:salary[^>]*from="([0-9.]+)"/)?.[1]
        const salMax   = item.match(/<indeed:salary[^>]*to="([0-9.]+)"/)?.[1]
        const desc     = item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/)?.[1]
                           ?.replace(/<[^>]+>/g, '').trim().slice(0, 5000) ?? null
        const pubDate  = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] ?? null
        const guid     = item.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1] ?? link

        if (!title || !link) continue

        allJobs.push({
          source:          'indeed_uk',
          external_id:     guid,
          title,
          company,
          location,
          country:         'GB',
          salary_min:      salMin ? Math.round(parseFloat(salMin)) : null,
          salary_max:      salMax ? Math.round(parseFloat(salMax)) : null,
          currency:        'GBP',
          employment_type: null,
          remote_type:     detectRemote(title + ' ' + (desc ?? '')),
          description:     desc,
          url:             link,
          posted_at:       pubDate ? new Date(pubDate).toISOString() : null,
          raw_payload:     { title, link, company, location },
        })
      }

      await new Promise(r => setTimeout(r, 500)) // be polite between requests
    } catch (err) {
      console.warn('[jobFetcher] Indeed UK fetch failed:', err instanceof Error ? err.message : err)
    }
  }

  // Deduplicate by external_id
  const seen = new Set<string>()
  return allJobs.filter(j => {
    if (seen.has(j.external_id)) return false
    seen.add(j.external_id)
    return true
  })
}

// ── RemoteOK ──────────────────────────────────────────────────────────────────
// Free API, no key. Returns ~100 remote jobs. Filter to UK/worldwide-remote.

async function fetchRemoteOK(): Promise<NormalisedJob[]> {
  const r = await fetch('https://remoteok.com/api', {
    headers: { 'User-Agent': 'FENJobAgent/1.0 (+https://fen.app)', Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`RemoteOK ${r.status}`)

  const data = await r.json() as RemoteOKJob[]
  const jobs = Array.isArray(data) ? data.slice(1) : [] // first element is legal notice object

  return jobs.map(j => ({
    source:          'remoteok',
    external_id:     String(j.id),
    title:           j.position,
    company:         j.company ?? null,
    location:        j.location || 'Remote',
    country:         'REMOTE',
    salary_min:      j.salary_min ? Math.round(j.salary_min) : null,
    salary_max:      j.salary_max ? Math.round(j.salary_max) : null,
    currency:        'USD',
    employment_type: null,
    remote_type:     'remote',
    description:     j.description?.replace(/<[^>]+>/g, '').slice(0, 5000) ?? null,
    url:             j.url ?? null,
    posted_at:       j.date ?? null,
    raw_payload:     j,
  }))
}

interface RemoteOKJob {
  id:           number
  position:     string
  company?:     string
  location?:    string
  salary_min?:  number
  salary_max?:  number
  description?: string
  url?:         string
  date?:        string
  tags?:        string[]
}

// ── The Muse ──────────────────────────────────────────────────────────────────
// Free API, no key. Supports location filter. Good for London/UK tech roles.

async function fetchTheMuse(): Promise<NormalisedJob[]> {
  const r = await fetch(
    'https://www.themuse.com/api/public/jobs?page=0&location=London%2C%20England&descending=true',
    { headers: { Accept: 'application/json' } }
  )
  if (!r.ok) throw new Error(`TheMuse ${r.status}`)

  const data = await r.json() as { results?: TheMuseJob[] }

  return (data.results ?? []).map(j => {
    const loc = j.locations?.[0]?.name ?? null
    return {
      source:          'the_muse',
      external_id:     String(j.id),
      title:           j.name,
      company:         j.company?.name ?? null,
      location:        loc,
      country:         'GB',
      salary_min:      null,
      salary_max:      null,
      currency:        'GBP',
      employment_type: j.type ?? null,
      remote_type:     detectRemote(j.name + ' ' + (loc ?? '')),
      description:     j.contents?.replace(/<[^>]+>/g, '').slice(0, 5000) ?? null,
      url:             j.refs?.landing_page ?? null,
      posted_at:       j.publication_date ?? null,
      raw_payload:     j,
    }
  })
}

interface TheMuseJob {
  id:               number
  name:             string
  type?:            string
  contents?:        string
  publication_date?:string
  locations?:       { name: string }[]
  company?:         { name: string }
  refs?:            { landing_page: string }
}

// ── Jobicy ────────────────────────────────────────────────────────────────────
// Free API, no key. Remote jobs across all categories including HR/recruiting.

async function fetchJobicy(): Promise<NormalisedJob[]> {
  const r = await fetch('https://jobicy.com/api/v2/remote-jobs?count=50&tag=recruiting,hr,talent,sourcing', {
    headers: { 'User-Agent': 'FENJobAgent/1.0', Accept: 'application/json' },
  })
  if (!r.ok) throw new Error(`Jobicy ${r.status}`)

  const data = await r.json() as { jobs?: JobicyJob[] }
  return (data.jobs ?? []).map(j => ({
    source:          'jobicy',
    external_id:     String(j.id),
    title:           j.jobTitle,
    company:         j.companyName ?? null,
    location:        j.jobGeo || 'Remote',
    country:         'REMOTE',
    salary_min:      null,
    salary_max:      null,
    currency:        'USD',
    employment_type: j.jobType ?? null,
    remote_type:     'remote' as const,
    description:     j.jobDescription?.replace(/<[^>]+>/g, '').slice(0, 5000) ?? null,
    url:             j.url ?? null,
    posted_at:       j.pubDate ?? null,
    raw_payload:     j,
  }))
}

interface JobicyJob {
  id:              number
  jobTitle:        string
  companyName?:    string
  jobGeo?:         string
  jobType?:        string
  jobDescription?: string
  url?:            string
  pubDate?:        string
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

// ── Apify helpers ─────────────────────────────────────────────────────────────

async function getApifyClient() {
  const token = process.env.APIFY_API_TOKEN
  if (!token) return null
  const { ApifyClient } = await import('apify-client')
  return new ApifyClient({ token })
}

function parseSalaryMin(s: string): number | null {
  const m = s.match(/[\d,]+/)
  return m ? parseInt(m[0].replace(/,/g, ''), 10) || null : null
}

function parseSalaryMax(s: string): number | null {
  const parts = s.match(/[\d,]+/g)
  if (!parts || parts.length < 2) return parseSalaryMin(s)
  return parseInt(parts[parts.length - 1].replace(/,/g, ''), 10) || null
}

// ── Apify: Indeed UK ─────────────────────────────────────────────────────────
// Actor: borderline/indeed-scraper (16K runs, 4.9★)

async function fetchApifyIndeed(keywords: string): Promise<NormalisedJob[]> {
  const client = await getApifyClient()
  if (!client) { console.log('[jobFetcher] APIFY_API_TOKEN not set — skipping apify_indeed'); return [] }

  const { defaultDatasetId } = await client.actor('borderline/indeed-scraper').call({
    query:    keywords,
    country:  'uk',
    location: 'London',
    maxItems: 50,
  })

  const { items } = await client.dataset(defaultDatasetId).listItems()

  return (items as Record<string, unknown>[]).map(j => ({
    source:          'apify_indeed',
    external_id:     String(j.id ?? j.url ?? ''),
    title:           String(j.positionName ?? ''),
    company:         j.company as string ?? null,
    location:        j.location as string ?? null,
    country:         'GB',
    salary_min:      parseSalaryMin(String(j.salary ?? '')),
    salary_max:      parseSalaryMax(String(j.salary ?? '')),
    currency:        'GBP',
    employment_type: j.jobType as string ?? null,
    remote_type:     detectRemote(String(j.positionName ?? '') + ' ' + String(j.description ?? '')),
    description:     String(j.description ?? '').slice(0, 5000),
    url:             j.url as string ?? null,
    posted_at:       j.datePosted as string ?? null,
    raw_payload:     j,
  })).filter(j => j.external_id && j.title)
}

// ── Apify: LinkedIn Jobs ──────────────────────────────────────────────────────
// LinkedIn via Apify requires a paid subscription — disabled until actor is rented
// To re-enable: set APIFY_LINKEDIN_ACTOR env var to the rented actor ID

async function fetchApifyLinkedIn(keywords: string): Promise<NormalisedJob[]> {
  const actorId = process.env.APIFY_LINKEDIN_ACTOR
  if (!actorId) { console.log('[jobFetcher] APIFY_LINKEDIN_ACTOR not set — skipping linkedin'); return [] }
  const client = await getApifyClient()
  if (!client) { console.log('[jobFetcher] APIFY_API_TOKEN not set — skipping apify_linkedin'); return [] }

  // Build LinkedIn search URLs from keywords (one per role term)
  const terms = keywords.split(' OR ').slice(0, 3).map(k => k.trim())
  const searchUrls = terms.map(t =>
    `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(t)}&location=London%2C%20United%20Kingdom&f_TPR=r604800`
  )

  const { defaultDatasetId } = await client.actor(actorId).call({
    startUrls:  searchUrls.map(url => ({ url })),
    maxResults: 50,
  })

  const { items } = await client.dataset(defaultDatasetId).listItems()

  return (items as Record<string, unknown>[]).map(j => ({
    source:          'apify_linkedin',
    external_id:     String(j.id ?? j.jobId ?? j.url ?? ''),
    title:           String(j.title ?? j.jobTitle ?? ''),
    company:         (j.companyName ?? j.company) as string ?? null,
    location:        j.location as string ?? null,
    country:         'GB',
    salary_min:      parseSalaryMin(String(j.salary ?? j.salaryRange ?? '')),
    salary_max:      parseSalaryMax(String(j.salary ?? j.salaryRange ?? '')),
    currency:        'GBP',
    employment_type: (j.contractType ?? j.employmentType) as string ?? null,
    remote_type:     detectRemote(String(j.title ?? '') + ' ' + String(j.description ?? '')),
    description:     String(j.description ?? j.descriptionHtml ?? '').replace(/<[^>]+>/g, '').slice(0, 5000),
    url:             (j.url ?? j.jobUrl ?? j.applyUrl) as string ?? null,
    posted_at:       (j.postedAt ?? j.publishedAt ?? j.datePosted) as string ?? null,
    raw_payload:     j,
  })).filter(j => j.external_id && j.title)
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

export async function fetchAllJobs(keywords?: string): Promise<void> {
  // If no keywords supplied, derive from all active tenant profiles (target_roles only)
  if (!keywords) {
    const { pool } = await import('../db/pool.js')
    const r = await pool.query<{ target_roles: string[] }>(
      `SELECT target_roles FROM user_profiles WHERE array_length(target_roles, 1) > 0 LIMIT 20`
    )
    const terms = new Set<string>()
    for (const row of r.rows) {
      for (const role of (row.target_roles ?? [])) {
        // Take first 3 words of each role to keep queries clean
        const clean = role.split(/\s+/).slice(0, 3).join(' ').trim()
        if (clean) terms.add(clean)
      }
    }
    keywords = terms.size > 0 ? [...terms].slice(0, 3).join(' OR ') : 'recruiter talent acquisition'
    console.log(`[jobFetcher] derived keywords from profiles: "${keywords}"`)
  }
  const sources = [
    { name: 'adzuna',      fn: () => fetchAdzuna(keywords) },
    { name: 'adzuna_hr',   fn: () => fetchAdzuna('recruiter OR "talent acquisition" OR "HR manager" OR "recruitment consultant"') },
    { name: 'reed',       fn: () => fetchReed(keywords) },
    { name: 'cv_library', fn: () => fetchCVLibrary(keywords) },
    { name: 'greenhouse', fn: () => fetchGreenhouse() },
    { name: 'lever',      fn: () => fetchLever() },
    { name: 'arbeitnow',  fn: () => fetchArbeitnow() },
    { name: 'remoteok',   fn: () => fetchRemoteOK() },
    { name: 'the_muse',   fn: () => fetchTheMuse() },
    { name: 'jobicy',        fn: () => fetchJobicy() },
    { name: 'indeed_uk',     fn: () => fetchIndeedUK(keywords) },
    { name: 'monster_uk',       fn: () => fetchMonsterUK(keywords) },
    { name: 'guardian_jobs',    fn: () => fetchGuardianJobsAPI(keywords) },
    { name: 'smartrecruiters',  fn: () => fetchSmartRecruiters() },
    { name: 'workable',         fn: () => fetchWorkable() },
    { name: 'apify_indeed',     fn: () => fetchApifyIndeed(keywords) },
    { name: 'apify_linkedin',   fn: () => fetchApifyLinkedIn(keywords) },
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
