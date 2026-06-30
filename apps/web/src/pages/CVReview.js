import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Brain, Building2, ChevronDown, ChevronUp, CheckCircle, XCircle, AlertCircle } from 'lucide-react';
function priorityColor(p) {
    if (p === 'high')
        return 'badge-danger';
    if (p === 'medium')
        return 'badge-warning';
    return 'badge-neutral';
}
function ATSRing({ score }) {
    const size = 80, sw = 7;
    const r = (size - sw) / 2;
    const circ = 2 * Math.PI * r;
    const fill = (score / 100) * circ;
    const color = score >= 70 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
    return (_jsxs("div", { style: { position: 'relative', width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }, children: [_jsxs("svg", { width: size, height: size, style: { transform: 'rotate(-90deg)' }, children: [_jsx("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", stroke: "var(--surface-1)", strokeWidth: sw }), _jsx("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", stroke: color, strokeWidth: sw, strokeDasharray: `${fill} ${circ}`, strokeLinecap: "round" })] }), _jsx("div", { style: { position: 'absolute', fontWeight: 700, fontSize: 18, color }, children: score })] }));
}
function Section({ title, children, defaultOpen = true }) {
    const [open, setOpen] = useState(defaultOpen);
    return (_jsxs("div", { style: { borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }, children: [_jsxs("button", { onClick: () => setOpen(o => !o), style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }, children: [_jsx("span", { style: { fontWeight: 600, fontSize: 14 }, children: title }), open ? _jsx(ChevronUp, { size: 16 }) : _jsx(ChevronDown, { size: 16 })] }), open && _jsx("div", { style: { marginTop: 12 }, children: children })] }));
}
function BulletList({ items, variant = 'neutral' }) {
    const icon = variant === 'success' ? _jsx(CheckCircle, { size: 14, style: { color: 'var(--success)', flexShrink: 0 } })
        : variant === 'danger' ? _jsx(XCircle, { size: 14, style: { color: 'var(--danger)', flexShrink: 0 } })
            : _jsx(AlertCircle, { size: 14, style: { color: 'var(--warning)', flexShrink: 0 } });
    return (_jsx("ul", { style: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }, children: items.map((item, i) => (_jsxs("li", { style: { display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 14 }, children: [_jsx("span", { style: { marginTop: 2 }, children: icon }), _jsx("span", { children: item })] }, i))) }));
}
export function CVReview() {
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const runReview = async () => {
        setLoading(true);
        setError('');
        try {
            const token = localStorage.getItem('fen_token');
            const res = await fetch('/cv/review', {
                headers: token ? { Authorization: `Bearer ${token}` } : {},
            });
            if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                throw new Error(j.message ?? `${res.status}`);
            }
            setResult(await res.json());
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Review failed');
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "CV Review" }), _jsx("p", { className: "page-sub", children: "Run a stored CV review when you want feedback on clarity, ATS risk, and missing keywords." })] }), !result && !loading && (_jsxs("div", { className: "card", style: { maxWidth: 640 }, children: [_jsxs("div", { style: { display: 'flex', gap: 16, marginBottom: 20 }, children: [_jsxs("div", { style: { flex: 1, padding: '16px', background: 'var(--surface-1)', borderRadius: 10 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }, children: [_jsx(Brain, { size: 18, style: { color: 'var(--accent)' } }), _jsx("span", { style: { fontWeight: 600, fontSize: 13 }, children: "Recruiter pass 1" })] }), _jsx("p", { className: "text-sm text-muted", children: "High-level hiring manager verdict and improvement priorities." })] }), _jsxs("div", { style: { flex: 1, padding: '16px', background: 'var(--surface-1)', borderRadius: 10 }, children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }, children: [_jsx(Building2, { size: 18, style: { color: 'var(--success)' } }), _jsx("span", { style: { fontWeight: 600, fontSize: 13 }, children: "Recruiter pass 2" })] }), _jsx("p", { className: "text-sm text-muted", children: "ATS score, keyword gaps, and marketability checks." })] })] }), error && _jsx("div", { className: "banner banner-danger", style: { marginBottom: 16 }, children: error }), _jsx("button", { className: "btn btn-primary w-full", onClick: runReview, children: "Run CV Review \u2014 takes ~20 seconds" })] })), loading && (_jsxs("div", { className: "card", style: { maxWidth: 540, textAlign: 'center', padding: '48px 24px' }, children: [_jsx("div", { className: "spinner", style: { margin: '0 auto 16px', width: 28, height: 28 } }), _jsx("div", { style: { fontWeight: 500 }, children: "Two AI recruiters are reading your CV\u2026" }), _jsx("p", { className: "text-sm text-muted", style: { marginTop: 6 }, children: "Claude Opus + GPT-4o running in parallel. ~20 seconds." })] })), result && (_jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, maxWidth: 1000 }, children: [_jsxs("div", { className: "card", children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }, children: [_jsx(Brain, { size: 16, style: { color: 'var(--accent)' } }), _jsx("span", { style: { fontWeight: 600, fontSize: 13, color: 'var(--accent)' }, children: "Claude Opus \u00B7 In-house Recruiter" })] }), !result.inhouse ? (_jsx("div", { className: "banner banner-danger", style: { marginTop: 12 }, children: result.errors?.inhouse ?? 'Claude review unavailable' })) : (_jsxs(_Fragment, { children: [_jsxs("div", { style: { padding: '12px', background: result.inhouse.would_call ? 'var(--success-light)' : 'var(--danger-light)', borderRadius: 8, marginTop: 12 }, children: [_jsx("div", { style: { fontWeight: 600, fontSize: 13, color: result.inhouse.would_call ? 'var(--success)' : 'var(--danger)' }, children: result.inhouse.would_call ? '✓ Would call for interview' : '✗ Would not call' }), _jsx("div", { style: { fontSize: 13, marginTop: 4 }, children: result.inhouse.verdict })] }), _jsx(Section, { title: "First impression", children: _jsx("p", { className: "text-sm", children: result.inhouse.first_impression }) }), _jsx(Section, { title: "Strengths", children: _jsx(BulletList, { items: result.inhouse.strengths, variant: "success" }) }), _jsx(Section, { title: "Weaknesses", children: _jsx(BulletList, { items: result.inhouse.weaknesses, variant: "danger" }) }), _jsx(Section, { title: "Improvements", children: _jsx("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: result.inhouse.improvements.map((imp, i) => (_jsxs("div", { style: { display: 'flex', gap: 10, alignItems: 'flex-start' }, children: [_jsx("span", { className: `badge ${priorityColor(imp.priority)}`, style: { flexShrink: 0, marginTop: 1 }, children: imp.priority }), _jsx("span", { className: "text-sm", children: imp.action })] }, i))) }) })] }))] }), _jsxs("div", { className: "card", children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }, children: [_jsx(Building2, { size: 16, style: { color: 'var(--success)' } }), _jsx("span", { style: { fontWeight: 600, fontSize: 13, color: 'var(--success)' }, children: "GPT-4o \u00B7 Agency Recruiter" })] }), !result.agency ? (_jsx("div", { className: "banner banner-warning", style: { marginTop: 12 }, children: result.errors?.agency?.includes('not configured')
                                    ? 'GPT-4o not configured on this server — Claude review above is complete.'
                                    : (result.errors?.agency ?? 'GPT review unavailable') })) : (_jsxs(_Fragment, { children: [_jsxs("div", { style: { display: 'flex', alignItems: 'center', gap: 16, marginTop: 12, padding: 12, background: 'var(--surface-1)', borderRadius: 8 }, children: [_jsx(ATSRing, { score: result.agency.ats_score }), _jsxs("div", { children: [_jsx("div", { style: { fontWeight: 600 }, children: "ATS Score" }), _jsx("div", { className: "text-sm text-muted", children: result.agency.ats_score >= 70 ? 'Likely to pass ATS filters' : result.agency.ats_score >= 50 ? 'May pass — improvements needed' : 'High risk of ATS rejection' })] })] }), _jsx(Section, { title: "Marketability", children: _jsx("p", { className: "text-sm", children: result.agency.marketability }) }), _jsx(Section, { title: "Keywords present", children: _jsx("div", { className: "job-tags", children: result.agency.keyword_hits.map(k => _jsx("span", { className: "badge badge-success", children: k }, k)) }) }), _jsx(Section, { title: "Missing keywords", children: _jsx("div", { className: "job-tags", children: result.agency.keyword_gaps.map(k => _jsx("span", { className: "badge badge-danger", children: k }, k)) }) }), _jsx(Section, { title: "ATS issues", children: _jsx(BulletList, { items: result.agency.ats_issues, variant: "danger" }) }), _jsx(Section, { title: "Quick wins", children: _jsx(BulletList, { items: result.agency.quick_wins, variant: "neutral" }) })] }))] })] })), result && (_jsx("button", { className: "btn btn-secondary btn-sm", style: { marginTop: 20 }, onClick: () => { setResult(null); setError(''); }, children: "Run again" }))] }));
}
