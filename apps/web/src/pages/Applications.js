import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { ScoreRing } from '../components/ScoreRing';
function stageLabel(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}
function stageColor(s) {
    if (s === 'offer')
        return 'var(--green)';
    if (s === 'interview')
        return 'var(--amber)';
    if (s === 'rejected')
        return 'var(--red)';
    return 'var(--muted)';
}
export function Applications() {
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => {
        api.getApplications()
            .then(setApps)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);
    if (loading)
        return _jsx("div", { className: "text-muted", children: "Loading\u2026" });
    if (error)
        return _jsx("div", { className: "error-box", children: error });
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "Applications" }), _jsxs("p", { className: "page-subtitle", children: [apps.length, " application", apps.length !== 1 ? 's' : '', " tracked"] })] }), apps.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("h3", { children: "No applications yet" }), _jsx("p", { children: "Apply to jobs from your matches and they'll appear here." })] })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 12 }, children: apps.map(a => (_jsxs("div", { className: "card", style: { display: 'flex', gap: 16, alignItems: 'center' }, children: [_jsx(ScoreRing, { score: a.score, size: 44 }), _jsxs("div", { style: { flex: 1 }, children: [_jsx("div", { style: { fontWeight: 600, fontSize: 15 }, children: a.job.title }), _jsxs("div", { style: { color: 'var(--muted)', fontSize: 13 }, children: [a.job.company, " \u00B7 ", a.job.location] }), a.applied_at && (_jsxs("div", { style: { fontSize: 12, color: 'var(--muted)', marginTop: 2 }, children: ["Applied ", new Date(a.applied_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })] }))] }), a.status && (_jsx("span", { className: "pill", style: {
                                background: `${stageColor(a.status)}20`,
                                color: stageColor(a.status),
                                border: `1px solid ${stageColor(a.status)}40`,
                            }, children: stageLabel(a.status) }))] }, a.id))) }))] }));
}
