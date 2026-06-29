import type { UserProfile, JobMatch, TodayStats } from './types'

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
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return res.json() as Promise<T>
}

// ── Mock data ────────────────────────────────────────────────────────────────

import { mockProfile, mockStats, mockMatches } from '../data/mockData'

const mockApi = {
  getProfile: async () => mockProfile,
  updateProfile: async (data: Partial<UserProfile>) => ({ ...mockProfile, ...data }),
  getStats: async () => mockStats,
  getMatches: async () => mockMatches,
  getApplications: async () => mockMatches.filter(m => m.applied),
  sendMagicLink: async (_email: string) => ({ ok: true }),
  verifyToken: async (_token: string) => ({ token: 'mock-token', email: 'demo@example.com', tenantId: 'mock-tenant' }),
  uploadCV: async (_file: File) => mockProfile,
  generateTelegramToken: async () => ({ token: 'abc123def456789012345678901234ab' }),
}

const liveApi = {
  getProfile: () => apiFetch<UserProfile>('/api/profile'),
  updateProfile: (data: Partial<UserProfile>) => apiFetch<UserProfile>('/api/profile', { method: 'PATCH', body: JSON.stringify(data) }),
  getStats: () => apiFetch<TodayStats>('/api/stats/today'),
  getMatches: () => apiFetch<JobMatch[]>('/api/matches'),
  getApplications: () => apiFetch<JobMatch[]>('/api/applications'),
  sendMagicLink: (email: string) => apiFetch<{ ok: boolean }>('/api/auth/magic-link', { method: 'POST', body: JSON.stringify({ email }) }),
  verifyToken: (token: string) => apiFetch<{ token: string; email: string; tenantId: string }>(`/api/auth/verify?token=${token}`),
  uploadCV: async (file: File) => {
    const token = getToken()
    const fd = new FormData()
    fd.append('cv', file)
    const res = await fetch(`${API_BASE}/api/cv/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: fd,
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    return res.json() as Promise<UserProfile>
  },
  generateTelegramToken: () => apiFetch<{ token: string }>('/api/telegram/connect-token', { method: 'POST' }),
}

export const api = USE_MOCKS ? mockApi : liveApi
