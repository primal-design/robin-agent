import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { Sparkles, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { JobCard } from '../components/JobCard';
async function triggerScan() {
    const token = localStorage.getItem('fen_token');
    const res = await fetch('/matches/run', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
    });
    if (!res.ok)
        throw new Error(`${res.status} ${res.statusText}`);
}
export function Matches() {
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [scanMsg, setScanMsg] = useState('');
    const [error, setError] = useState('');
    const load = () => {
        setLoading(true);
        api.getMatches()
            .then(setMatches)
            .catch(e => { if (!e.message?.includes('404'))
            setError(e.message); })
            .finally(() => setLoading(false));
    };
    useEffect(load, []);
    const runScan = async () => {
        setScanning(true);
        setScanMsg('');
        setError('');
        try {
            await triggerScan();
            setScanMsg('Scanning jobs… this takes ~30 seconds.');
            setTimeout(() => { setScanMsg('Refreshing matches…'); load(); }, 35000);
            setTimeout(() => setScanMsg(''), 37000);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Scan failed');
        }
        finally {
            setScanning(false);
        }
    };
    if (loading)
        return _jsx("div", { className: "text-muted", style: { padding: 8 }, children: "Loading\u2026" });
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16, flexWrap: 'wrap' }, children: [_jsxs("div", { className: "page-header", style: { marginBottom: 0 }, children: [_jsx("h1", { className: "page-title", children: "Matches" }), _jsxs("p", { className: "page-sub", children: [matches.length, " job", matches.length !== 1 ? 's' : '', " matched to your profile"] })] }), _jsxs("button", { className: "btn btn-secondary", onClick: runScan, disabled: scanning, style: { flexShrink: 0 }, children: [_jsx(RefreshCw, { size: 14, className: scanning ? 'spin' : '' }), scanning ? 'Scanning…' : 'Run scan now'] })] }), error && _jsx("div", { className: "banner banner-danger", style: { marginBottom: 16 }, children: error }), scanMsg && _jsx("div", { className: "banner banner-success", style: { marginBottom: 16 }, children: scanMsg }), matches.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-icon", children: _jsx(Sparkles, { size: 32, strokeWidth: 1.5 }) }), _jsx("h3", { children: "No matches yet" }), _jsx("p", { children: "Hit \"Run scan now\" to fetch jobs and match them to your profile." })] })) : (matches.map(m => _jsx(JobCard, { match: m }, m.id)))] }));
}
