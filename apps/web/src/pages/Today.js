import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { JobCard } from '../components/JobCard';
export function Today() {
    const [stats, setStats] = useState(null);
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => {
        Promise.all([api.getStats(), api.getMatches()])
            .then(([s, m]) => { setStats(s); setMatches(m.slice(0, 3)); })
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);
    if (loading)
        return _jsx("div", { className: "text-muted", children: "Loading\u2026" });
    if (error)
        return _jsx("div", { className: "banner banner-danger", children: error });
    const nextScan = stats?.next_scan
        ? new Date(stats.next_scan).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : null;
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "Today" }), _jsxs("p", { className: "page-sub", children: ["Your job search is running.", nextScan && ` Next scan at ${nextScan}.`] })] }), stats && (_jsx("div", { className: "card-grid", style: { marginBottom: 32 }, children: [
                    { value: stats.jobs_scanned.toLocaleString(), label: 'Jobs scanned' },
                    { value: stats.matches_found, label: 'New matches' },
                    { value: stats.applications_sent, label: 'Applications' },
                    { value: stats.interviews, label: 'Interviews' },
                ].map(({ value, label }) => (_jsxs("div", { className: "metric-card", children: [_jsx("div", { className: "metric-value", children: value }), _jsx("div", { className: "metric-label", children: label })] }, label))) })), matches.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h2", { style: { fontWeight: 600, marginBottom: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 12 }, children: "Top matches today" }), matches.map(m => _jsx(JobCard, { match: m }, m.id)), _jsx("a", { href: "/app/matches", className: "btn btn-secondary btn-sm", style: { marginTop: 8 }, children: "See all matches \u2192" })] }))] }));
}
