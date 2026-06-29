import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { api } from '../lib/api';
import { ProgressRing } from '../components/ProgressRing';
function statusBadge(status) {
    const map = {
        applied: 'badge-neutral',
        interview: 'badge-warning',
        offer: 'badge-success',
        rejected: 'badge-danger',
    };
    return map[status] ?? 'badge-neutral';
}
export function Applications() {
    const [apps, setApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => {
        api.getApplications().then(setApps).catch(e => setError(e.message)).finally(() => setLoading(false));
    }, []);
    if (loading)
        return _jsx("div", { className: "text-muted", children: "Loading\u2026" });
    if (error)
        return _jsx("div", { className: "banner banner-danger", children: error });
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "Applications" }), _jsxs("p", { className: "page-sub", children: [apps.length, " application", apps.length !== 1 ? 's' : '', " tracked"] })] }), apps.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-icon", children: _jsx(ClipboardList, { size: 32, strokeWidth: 1.5 }) }), _jsx("h3", { children: "No applications yet" }), _jsx("p", { children: "Apply to jobs from your matches and they'll appear here." })] })) : (_jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: apps.map(a => (_jsxs("div", { className: "card", style: { display: 'flex', gap: 14, alignItems: 'center' }, children: [_jsx(ProgressRing, { value: a.score, size: 44 }), _jsxs("div", { style: { flex: 1, minWidth: 0 }, children: [_jsx("div", { className: "job-title", children: a.job.title }), _jsxs("div", { className: "job-company", children: [a.job.company, a.job.location ? ` · ${a.job.location}` : ''] }), a.applied_at && (_jsxs("div", { className: "text-xs text-muted", style: { marginTop: 2 }, children: ["Applied ", new Date(a.applied_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })] }))] }), a.status && (_jsx("span", { className: `badge ${statusBadge(a.status)}`, children: a.status.charAt(0).toUpperCase() + a.status.slice(1) }))] }, a.id))) }))] }));
}
