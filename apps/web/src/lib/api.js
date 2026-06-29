const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';
function getToken() {
    return localStorage.getItem('fen_token');
}
async function apiFetch(path, init) {
    const token = getToken();
    const res = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...init?.headers,
        },
    });
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
}
// ── Mock data ────────────────────────────────────────────────────────────────
import { mockProfile, mockStats, mockMatches } from '../data/mockData';
const mockApi = {
    getProfile: async () => mockProfile,
    updateProfile: async (data) => ({ ...mockProfile, ...data }),
    getStats: async () => mockStats,
    getMatches: async () => mockMatches,
    getApplications: async () => mockMatches.filter(m => m.applied),
    sendMagicLink: async (_email) => ({ ok: true }),
    verifyToken: async (_token) => ({ token: 'mock-token', email: 'demo@example.com', tenantId: 'mock-tenant' }),
    uploadCV: async (_file) => mockProfile,
    generateTelegramToken: async () => ({ token: 'abc123def456789012345678901234ab' }),
};
const liveApi = {
    getProfile: () => apiFetch('/api/profile'),
    updateProfile: (data) => apiFetch('/api/profile', { method: 'PATCH', body: JSON.stringify(data) }),
    getStats: () => apiFetch('/api/stats/today'),
    getMatches: () => apiFetch('/api/matches'),
    getApplications: () => apiFetch('/api/applications'),
    sendMagicLink: (email) => apiFetch('/api/auth/magic-link', { method: 'POST', body: JSON.stringify({ email }) }),
    verifyToken: (token) => apiFetch(`/api/auth/verify?token=${token}`),
    uploadCV: async (file) => {
        const token = getToken();
        const fd = new FormData();
        fd.append('cv', file);
        const res = await fetch(`${API_BASE}/api/cv/upload`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: fd,
        });
        if (!res.ok)
            throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
    },
    generateTelegramToken: () => apiFetch('/api/telegram/connect-token', { method: 'POST' }),
};
export const api = USE_MOCKS ? mockApi : liveApi;
