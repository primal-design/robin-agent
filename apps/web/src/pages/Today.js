import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { StatCard } from '../components/StatCard';
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
        return _jsx("div", { className: "error-box", children: error });
    const nextScan = stats?.next_scan
        ? new Date(stats.next_scan).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : null;
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "Today" }), _jsxs("p", { className: "page-subtitle", children: ["Your job search is running.", nextScan && ` Next scan at ${nextScan}.`] })] }), stats && (_jsxs("div", { className: "card-grid", style: { marginBottom: 32 }, children: [_jsx(StatCard, { value: stats.jobs_scanned.toLocaleString(), label: "Jobs scanned" }), _jsx(StatCard, { value: stats.matches_found, label: "New matches" }), _jsx(StatCard, { value: stats.applications_sent, label: "Applications sent" }), _jsx(StatCard, { value: stats.interviews, label: "Interviews" })] })), matches.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h2", { style: { fontFamily: 'Georgia, serif', fontSize: 18, marginBottom: 16 }, children: "Top matches today" }), matches.map(m => _jsx(JobCard, { match: m }, m.id)), _jsx("a", { href: "/app/matches", className: "btn btn-outline btn-sm", style: { marginTop: 8 }, children: "See all matches \u2192" })] }))] }));
}
