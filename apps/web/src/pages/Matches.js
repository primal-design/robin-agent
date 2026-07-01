import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Briefcase, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
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
function formatSalary(match) {
    const { salary_min: min, salary_max: max, salary_currency: currency = 'GBP' } = match.job;
    if (!min)
        return 'Not listed';
    const fmt = (value) => new Intl.NumberFormat('en-GB', {
        style: 'currency',
        currency,
        maximumFractionDigits: 0,
    }).format(value);
    return max ? `${fmt(min)} – ${fmt(max)}` : fmt(min);
}
function feedbackLabel(value) {
    if (value === 'interested')
        return 'Saved to applications';
    if (value === 'skip')
        return 'Skipped';
    if (value === 'not_relevant')
        return 'Hidden from your shortlist';
    return null;
}
export function Matches() {
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [scanMsg, setScanMsg] = useState('');
    const [elapsed, setElapsed] = useState(0);
    const [error, setError] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [feedbackState, setFeedbackState] = useState({});
    const [savingFeedback, setSavingFeedback] = useState(null);
    const pollRef = useRef(null);
    const timerRef = useRef(null);
    const load = (quiet = false) => {
        if (!quiet)
            setLoading(true);
        return api.getMatches()
            .then(m => {
            setMatches(m);
            setFeedbackState(current => {
                const next = { ...current };
                for (const match of m) {
                    if (match.user_feedback)
                        next[match.id] = match.user_feedback;
                }
                return next;
            });
            return m;
        })
            .catch(e => {
            if (e.message?.includes('profile_not_found')) {
                setError('Upload a CV first to start matching jobs.');
            }
            else if (!e.message?.includes('404')) {
                setError(e.message);
            }
            return [];
        })
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
    const visibleMatches = useMemo(() => matches.filter(match => {
        const feedback = feedbackState[match.id];
        return feedback !== 'skip' && feedback !== 'not_relevant';
    }), [feedbackState, matches]);
    useEffect(() => {
        if (!visibleMatches.length) {
            setSelectedId(null);
            return;
        }
        if (!selectedId || !visibleMatches.some(match => match.id === selectedId)) {
            setSelectedId(visibleMatches[0].id);
        }
    }, [selectedId, visibleMatches]);
    const selected = visibleMatches.find(match => match.id === selectedId) ?? visibleMatches[0] ?? null;
    const saveFeedback = async (feedback) => {
        if (!selected)
            return;
        setSavingFeedback(feedback);
        setError('');
        try {
            await api.setMatchFeedback(selected.id, feedback);
            setFeedbackState(current => ({ ...current, [selected.id]: feedback }));
            const label = feedback === 'interested'
                ? 'Saved to applications.'
                : feedback === 'skip'
                    ? 'Match skipped for now.'
                    : 'Match removed from your shortlist.';
            setScanMsg(label);
            setTimeout(() => setScanMsg(''), 3000);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Could not update this match');
        }
        finally {
            setSavingFeedback(null);
        }
    };
    if (loading)
        return _jsx("div", { className: "text-muted", style: { padding: 8 }, children: "Loading\u2026" });
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const elapsedStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    return (_jsxs("div", { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16, flexWrap: 'wrap' }, children: [_jsxs("div", { className: "page-header", style: { marginBottom: 0 }, children: [_jsx("h1", { className: "page-title", children: "Matches" }), _jsxs("p", { className: "page-sub", children: [visibleMatches.length, " job", visibleMatches.length !== 1 ? 's' : '', " ready to review.", matches.length !== visibleMatches.length ? ` ${matches.length - visibleMatches.length} hidden from this list.` : ''] })] }), _jsxs("button", { className: "btn btn-secondary", onClick: runScan, disabled: scanning, style: { flexShrink: 0 }, children: [_jsx(RefreshCw, { size: 14, style: scanning ? { animation: 'spin .8s linear infinite' } : {} }), scanning ? `Scanning… ${elapsedStr}` : 'Run scan now'] })] }), error && _jsx("div", { className: "banner banner-danger", style: { marginBottom: 16 }, children: error }), scanMsg && _jsx("div", { className: "banner banner-success", style: { marginBottom: 16 }, children: scanMsg }), scanning && (_jsx("div", { className: "banner banner-info", style: { marginBottom: 16 }, children: "Fetching jobs from Reed, LinkedIn, Indeed and more \u2014 this takes 2\u20133 minutes. Results will appear automatically." })), matches.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-icon", children: _jsx(Sparkles, { size: 32, strokeWidth: 1.5 }) }), _jsx("h3", { children: "No matches yet" }), _jsx("p", { children: "Hit \"Run scan now\" to fetch jobs and match them to your profile." })] })) : visibleMatches.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("div", { className: "empty-state-icon", children: _jsx(Sparkles, { size: 32, strokeWidth: 1.5 }) }), _jsx("h3", { children: "Your shortlist is empty" }), _jsx("p", { children: "Run another scan or upload a stronger CV to repopulate this list." })] })) : (_jsxs("div", { className: "matches-shell", children: [_jsxs("aside", { className: "match-list", children: [_jsxs("div", { className: "match-list-header", children: [_jsxs("div", { children: [_jsx("div", { className: "section-title", style: { marginBottom: 6 }, children: "Results" }), _jsxs("div", { className: "match-list-title", children: [visibleMatches.length, " active matches"] })] }), _jsxs("div", { className: "score-chip", children: [visibleMatches[0]?.score ?? 0, "+"] })] }), visibleMatches.map(match => {
                                const salary = formatSalary(match);
                                return (_jsxs("button", { type: "button", className: `jcard${selected?.id === match.id ? ' sel' : ''}`, onClick: () => setSelectedId(match.id), children: [_jsxs("div", { className: "jcard-top", children: [_jsxs("div", { children: [_jsx("div", { className: "jcard-title", children: match.job.title }), _jsx("div", { className: "jcard-co", children: match.job.company })] }), _jsx("div", { className: "score-chip", children: match.score })] }), _jsxs("div", { className: "jcard-pills", children: [match.job.location && _jsx("span", { className: "jpill", children: match.job.location }), salary !== 'Not listed' && _jsx("span", { className: "jpill", children: salary })] }), match.recommendation && (_jsx("div", { className: "jcard-reasons", children: match.recommendation.length > 108
                                                ? `${match.recommendation.slice(0, 108).trimEnd()}…`
                                                : match.recommendation }))] }, match.id));
                            })] }), _jsx("section", { className: "detail-panel", children: selected ? (_jsxs(_Fragment, { children: [_jsxs("div", { className: "detail-head", children: [_jsx("div", { className: "section-title", style: { marginBottom: 8 }, children: "Selected match" }), _jsx("h2", { className: "dp-title", children: selected.job.title }), _jsx("div", { className: "dp-co", children: selected.job.company })] }), _jsxs("div", { className: "score-row", children: [_jsx("div", { className: "score-chip score-chip-lg", children: selected.score }), _jsxs("div", { children: [_jsx("div", { className: "score-label", children: "Current fit score" }), _jsx("div", { className: "score-sub", children: selected.score >= 70
                                                        ? 'Strong fit based on your current profile.'
                                                        : selected.score >= 50
                                                            ? 'Reasonable fit, but still needs review.'
                                                            : 'Weak fit. Check the gaps before spending time here.' })] })] }), feedbackLabel(feedbackState[selected.id]) && (_jsx("div", { className: "banner banner-success mb-4", children: feedbackLabel(feedbackState[selected.id]) })), _jsxs("div", { className: "dp-grid", children: [_jsxs("div", { className: "dp-meta", children: [_jsx("div", { className: "dp-meta-key", children: "Location" }), _jsx("div", { className: "dp-meta-val", children: selected.job.location || 'Not listed' })] }), _jsxs("div", { className: "dp-meta", children: [_jsx("div", { className: "dp-meta-key", children: "Salary" }), _jsx("div", { className: "dp-meta-val", children: formatSalary(selected) })] }), _jsxs("div", { className: "dp-meta", children: [_jsx("div", { className: "dp-meta-key", children: "Source" }), _jsx("div", { className: "dp-meta-val", children: selected.job.source || 'Imported match' })] }), _jsxs("div", { className: "dp-meta", children: [_jsx("div", { className: "dp-meta-key", children: "Status" }), _jsx("div", { className: "dp-meta-val", children: feedbackLabel(feedbackState[selected.id]) || 'Awaiting decision' })] })] }), selected.recommendation && (_jsxs(_Fragment, { children: [_jsx("div", { className: "dp-section", children: "Why this showed up" }), _jsx("div", { className: "dp-rec", children: selected.recommendation })] })), selected.skill_matches.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "dp-section", children: "Strength matches" }), _jsx("div", { className: "job-tags", children: selected.skill_matches.map(skill => (_jsx("span", { className: "badge badge-success", children: skill }, skill))) })] })), selected.skill_gaps.length > 0 && (_jsxs(_Fragment, { children: [_jsx("div", { className: "dp-section", children: "Likely gaps" }), _jsx("div", { className: "job-tags", children: selected.skill_gaps.map(skill => (_jsx("span", { className: "badge badge-danger", children: skill }, skill))) })] })), selected.job.description && (_jsxs(_Fragment, { children: [_jsx("div", { className: "dp-section", children: "Job description" }), _jsx("div", { className: "detail-copy", children: selected.job.description.split(/\n{2,}/).slice(0, 4).map((paragraph, index) => (_jsx("p", { children: paragraph.trim() }, index))) })] })), _jsx("div", { className: "dp-section", children: "Next action" }), _jsxs("div", { className: "dp-actions", children: [selected.job.url && selected.job.url !== '#' && (_jsxs("a", { href: selected.job.url, target: "_blank", rel: "noreferrer", className: "btn btn-primary", children: [_jsx(ArrowUpRight, { size: 15, strokeWidth: 2 }), "Open listing"] })), _jsxs("button", { className: "btn btn-secondary", disabled: savingFeedback !== null || feedbackState[selected.id] === 'interested', onClick: () => saveFeedback('interested'), children: [_jsx(Briefcase, { size: 15, strokeWidth: 2 }), feedbackState[selected.id] === 'interested' ? 'Saved to applications' : savingFeedback === 'interested' ? 'Saving…' : 'Save to applications'] }), _jsx("button", { className: "btn btn-ghost", disabled: savingFeedback !== null, onClick: () => saveFeedback('not_relevant'), children: savingFeedback === 'not_relevant' ? 'Updating…' : 'Hide this match' })] })] })) : (_jsxs("div", { className: "detail-empty", children: [_jsx(Sparkles, { size: 30, strokeWidth: 1.5 }), _jsx("div", { className: "detail-empty-text", children: "Select a match to review the details." }), _jsx("div", { className: "detail-empty-sub", children: "Your strongest roles stay in the list on the left." })] })) })] }))] }));
}
