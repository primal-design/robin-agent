import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useRef, useState } from 'react';
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
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState('');
    const pollRef = useRef(null);
    const timerRef = useRef(null);
    const load = (quiet = false) => {
        if (!quiet)
            setLoading(true);
        return api.getMatches()
            .then(m => { setMatches(m); return m; })
            .catch(e => { if (!e.message?.includes('404'))
            setError(e.message); return []; })
            .finally(() => { if (!quiet)
            setLoading(false); });
    };
    useEffect(() => { load(); }, []);
    const stopPoll = () => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    };
    const runScan = async () => {
        setScanning(true);
        setScanMsg('');
        setError('');
        setElapsed(0);
        try {
            await triggerScan();
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Scan failed');
            setScanning(false);
            return;
        }
        // Tick elapsed time
        timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
        // Poll every 15s for up to 3 minutes
        let attempts = 0;
        const maxAttempts = 12;
        pollRef.current = setInterval(async () => {
            attempts++;
            const found = await load(true);
            if (found.length > 0 || attempts >= maxAttempts) {
                stopPoll();
                setScanning(false);
                setScanMsg(found.length > 0 ? `Found ${found.length} match${found.length !== 1 ? 'es' : ''}!` : 'Scan complete — no matches yet. Try again later.');
                setTimeout(() => setScanMsg(''), 4000);
            }
        }, 15000);
    };
    // Cleanup on unmount
    useEffect(() => () => stopPoll(), []);
    if (loading)
        return _jsx("div", { className: "text-muted", style: { padding: 8 }, children: "Loading\u2026" });
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16, flexWrap: 'wrap' }, children: [_jsxs("div", { className: "page-header", style: { marginBottom: 0 }, children: [_jsx("h1", { className: "page-title", children: "Matches" }), _jsxs("p", { className: "page-sub", children: [matches.length, " job", matches.length !== 1 ? 's' : '', " matched to your profile."] })] }), _jsxs("button", { className: "btn btn-secondary", onClick: runScan, disabled: scanning, style: { flexShrink: 0 }, children: [_jsx(RefreshCw, { size: 14, style: scanning ? { animation: 'spin .8s linear infinite' } : {} }), scanning ? `Scanning… ${elapsedStr}` : 'Run scan now'] })] }), error && _jsx("div", { className: "banner banner-danger", style: { marginBottom: 16 }, children: error }), scanMsg && _jsx("div", { className: "banner banner-success", style: { marginBottom: 16 }, children: scanMsg }), scanning && (_jsx("div", { className: "banner banner-info", style: { marginBottom: 16 }, children: "Fetching jobs from Reed, LinkedIn, Indeed and more \u2014 this takes 2\u20133 minutes. Results will appear automatically." })), matches.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-icon", children: _jsx(Sparkles, { size: 32, strokeWidth: 1.5 }) }), _jsx("h3", { children: "No matches yet" }), _jsx("p", { children: "Hit \"Run scan now\" to fetch jobs and match them to your profile." })] })) : (_jsxs("div", { children: [_jsx("div", { className: "section-header", children: _jsx("div", { className: "section-title", children: "Results" }) }), matches.map(m => _jsx(JobCard, { match: m }, m.id))] }))] }));
}
