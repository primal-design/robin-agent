import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Upload } from 'lucide-react';
import { api } from '../lib/api';
import { JobCard } from '../components/JobCard';
export function Today() {
    const [stats, setStats] = useState(null);
    const [matches, setMatches] = useState([]);
    const [noProfile, setNoProfile] = useState(false);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        Promise.all([api.getStats(), api.getMatches()])
            .then(([s, m]) => { setStats(s); setMatches(m.slice(0, 3)); })
            .catch(e => {
            // 404 means no CV uploaded yet
            if (e.message?.includes('404'))
                setNoProfile(true);
        })
            .finally(() => setLoading(false));
    }, []);
    if (loading)
        return _jsx("div", { className: "text-muted", style: { padding: 8 }, children: "Loading\u2026" });
    if (noProfile)
        return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "Welcome to FEN" }), _jsx("p", { className: "page-sub", children: "Upload your CV to get started." })] }), _jsx("div", { className: "card", style: { maxWidth: 480 }, children: _jsxs("div", { style: { display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '32px 20px', gap: 16, textAlign: 'center' }, children: [_jsx(Upload, { size: 36, strokeWidth: 1.5, style: { color: 'var(--text-faint)' } }), _jsxs("div", { children: [_jsx("h3", { style: { marginBottom: 6 }, children: "No profile yet" }), _jsx("p", { className: "text-sm text-muted", children: "FEN needs your CV to start matching jobs. It takes about 30 seconds." })] }), _jsx(Link, { to: "/app/cv-lab", className: "btn btn-primary", children: "Upload CV \u2192" })] }) })] }));
    const nextScan = stats?.next_scan
        ? new Date(stats.next_scan).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
        : null;
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "Today" }), _jsxs("p", { className: "page-sub", children: ["Your job search is running.", nextScan && ` Next scan at ${nextScan}.`] })] }), stats && (_jsx("div", { className: "card-grid", style: { marginBottom: 32 }, children: [
                    { value: stats.jobs_scanned.toLocaleString(), label: 'Jobs scanned' },
                    { value: stats.matches_found, label: 'New matches' },
                    { value: stats.applications_sent, label: 'Applications' },
                    { value: stats.interviews, label: 'Interviews' },
                ].map(({ value, label }) => (_jsxs("div", { className: "metric-card", children: [_jsx("div", { className: "metric-value", children: value }), _jsx("div", { className: "metric-label", children: label })] }, label))) })), matches.length > 0 && (_jsxs(_Fragment, { children: [_jsx("h2", { style: { fontWeight: 600, marginBottom: 14, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontSize: 12 }, children: "Top matches today" }), matches.map(m => _jsx(JobCard, { match: m }, m.id)), _jsx(Link, { to: "/app/matches", className: "btn btn-secondary btn-sm", style: { marginTop: 8 }, children: "See all matches \u2192" })] })), matches.length === 0 && !noProfile && (_jsx("div", { className: "card", style: { maxWidth: 480 }, children: _jsxs("div", { style: { padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }, children: [_jsx("p", { children: "No matches yet \u2014 FEN is scanning jobs for your profile." }), _jsx("p", { className: "text-sm", style: { marginTop: 6 }, children: "Check back soon or trigger a scan from Matches." })] }) }))] }));
}
