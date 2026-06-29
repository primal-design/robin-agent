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
function normalizeMatch(r) {
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
        applied: false,
        status: 'new',
    };
}
// /matches returns { matches: [...], profile_id }
async function fetchMatches() {
    const data = await apiFetch('/matches');
    return (data.matches ?? []).map(normalizeMatch);
}
// Derive stats from matches (no dedicated stats endpoint)
async function fetchStats() {
    try {
        const matches = await fetchMatches();
        const applied = matches.filter(m => m.applied);
        const interviews = applied.filter(m => m.status === 'interview' || m.status === 'offer');
        return { jobs_scanned: 0, matches_found: matches.length, applications_sent: applied.length, interviews: interviews.length };
    }
    catch {
        return { jobs_scanned: 0, matches_found: 0, applications_sent: 0, interviews: 0 };
    }
}
// CV upload: send file as base64 JSON (backend expects file_data + file_name)
async function uploadCVFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
            try {
                const base64 = reader.result.split(',')[1];
                const data = await apiFetch('/profile/cv', {
                    method: 'POST',
                    body: JSON.stringify({ file_data: base64, file_name: file.name, file_type: file.type }),
                });
                resolve(data.profile);
            }
            catch (e) {
                reject(e);
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
    });
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
    uploadCV: async (_file) => mockProfile,
    generateTelegramToken: async () => ({ token: 'abc123def456789012345678901234ab' }),
};
const liveApi = {
    getProfile: () => apiFetch('/profile'),
    updateProfile: (data) => apiFetch('/profile', { method: 'PATCH', body: JSON.stringify(data) }),
    getStats: fetchStats,
    getMatches: fetchMatches,
    getApplications: async () => {
        const rows = await apiFetch('/applications');
        return rows.map(r => ({
            id: r.id,
            job: { id: r.id, title: r.title, company: r.company, location: r.location, salary_min: r.salary_min, salary_max: r.salary_max, url: r.url },
            score: r.match_score ?? 0,
            skill_matches: [], skill_gaps: [],
            applied: true,
            status: r.status,
            applied_at: r.applied_at,
        }));
    },
    sendMagicLink: (email) => apiFetch('/auth/send-magic-link', { method: 'POST', body: JSON.stringify({ email }) }),
    uploadCV: uploadCVFile,
    generateTelegramToken: () => apiFetch('/profile/telegram-connect'),
};
export const api = USE_MOCKS ? mockApi : liveApi;
