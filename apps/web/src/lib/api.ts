import type { UserProfile, JobMatch, TodayStats, MatchFeedback } from './types'

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true'
const API_BASE  = import.meta.env.VITE_API_BASE_URL ?? ''

function getToken(): string | null {
  return localStorage.getItem('fen_token')
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null) as
      | { error?: string; message?: string; hint?: string }
      | null
    const detail = data?.message ?? data?.error ?? data?.hint
    throw new Error(detail || `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

// The backend returns flat rows — remap to JobMatch shape
interface RawMatch {
  match_id: string
  job_id: string
  title: string
  company: string
  location?: string
  salary_min?: number
  salary_max?: number
  remote_type?: string
  url?: string
  suitability_score: number
  match_reasons?: string[]
  missing_skills?: string[]
  llm_summary?: string
  user_feedback?: string
}

function normalizeMatch(r: RawMatch): JobMatch {
  return {
    id: r.match_id,
    job: {
      id: r.job_id,
      title: r.title,
      company: r.company,
      location: r.location,
      salary_min: r.salary_min,
      salary_max: r.salary_max,
      url: r.url,
    },
    score: r.suitability_score,
    skill_matches: r.match_reasons ?? [],
    skill_gaps: r.missing_skills ?? [],
    recommendation: r.llm_summary,
    user_feedback: r.user_feedback as MatchFeedback | undefined,
    applied: false,
    status: 'new',
  }
}

// /matches returns { matches: [...], profile_id }
async function fetchMatches(): Promise<JobMatch[]> {
  const data = await apiFetch<{ matches: RawMatch[] }>('/matches')
  return (data.matches ?? []).map(normalizeMatch)
}

// Derive stats from matches (no dedicated stats endpoint)
async function fetchStats(): Promise<TodayStats> {
  try {
    const matches = await fetchMatches()
    const applied     = matches.filter(m => m.applied)
    const interviews  = applied.filter(m => m.status === 'interview' || m.status === 'offer')
    return { jobs_scanned: 0, matches_found: matches.length, applications_sent: applied.length, interviews: interviews.length }
  } catch {
    return { jobs_scanned: 0, matches_found: 0, applications_sent: 0, interviews: 0 }
  }
}

// CV upload: send file as base64 JSON (backend expects file_data + file_name)
async function uploadCVFile(file: File): Promise<UserProfile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1]
        const data = await apiFetch<{ profile: UserProfile }>('/profile/cv', {
          method: 'POST',
          body: JSON.stringify({ file_data: base64, file_name: file.name, file_type: file.type }),
        })
        resolve(data.profile)
      } catch (e) { reject(e) }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

// ── Mock data ────────────────────────────────────────────────────────────────

import { mockProfile, mockStats, mockMatches } from '../data/mockData'

const mockApi = {
  getProfile:            async () => mockProfile,
  updateProfile:         async (data: Partial<UserProfile>) => ({ ...mockProfile, ...data }),
  getStats:              async () => mockStats,
  getMatches:            async () => mockMatches,
  getApplications:       async () => mockMatches.filter(m => m.applied),
  sendMagicLink:         async (_email: string) => ({ ok: true }),
  uploadCV:              async (_file: File) => mockProfile,
  clearProfile:          async () => ({ ok: true }),
  setMatchFeedback:      async (_id: string, _feedback: MatchFeedback) => ({ ok: true }),
  generateTelegramToken: async () => ({ token: 'abc123def456789012345678901234ab' }),
}

const liveApi = {
  getProfile: () => apiFetch<UserProfile | null>('/profile'),

  updateProfile: (data: Partial<UserProfile>) =>
    apiFetch<UserProfile>('/profile', { method: 'PATCH', body: JSON.stringify(data) }),

  getStats: fetchStats,

  getMatches: fetchMatches,

  getApplications: async () => {
    interface RawApp { id: string; title: string; company: string; location?: string; salary_min?: number; salary_max?: number; url?: string; match_score: number; status: string; applied_at?: string }
    const rows = await apiFetch<RawApp[]>('/applications')
    return rows.map(r => ({
      id: r.id,
      job: { id: r.id, title: r.title, company: r.company, location: r.location, salary_min: r.salary_min, salary_max: r.salary_max, url: r.url },
      score: r.match_score ?? 0,
      skill_matches: [], skill_gaps: [],
      applied: true,
      status: r.status as JobMatch['status'],
      applied_at: r.applied_at,
    }))
  },

  sendMagicLink: (email: string) =>
    apiFetch<{ ok: boolean }>('/auth/send-magic-link', { method: 'POST', body: JSON.stringify({ email }) }),

  uploadCV: uploadCVFile,

  clearProfile: () =>
    apiFetch<{ ok: boolean; cleared: boolean }>('/profile', { method: 'DELETE' }),

  setMatchFeedback: (id: string, feedback: MatchFeedback) =>
    apiFetch<{ ok: boolean }>(`/matches/${id}/feedback`, {
      method: 'PATCH',
      body: JSON.stringify({ feedback }),
    }),

  generateTelegramToken: () =>
    apiFetch<{ token: string }>('/profile/telegram-connect'),
}

export const api = USE_MOCKS ? mockApi : liveApi
