import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { ScoreRing } from './ScoreRing';
function fmt(n, currency = 'GBP') {
    if (!n)
        return null;
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
}
export function JobCard({ match, onApply }) {
    const { job, score, skill_matches, skill_gaps, applied, recommendation } = match;
    const salaryMin = fmt(job.salary_min, job.salary_currency);
    const salaryMax = fmt(job.salary_max, job.salary_currency);
    const salary = salaryMin ? `${salaryMin}${salaryMax ? ` – ${salaryMax}` : ''}` : null;
    return (_jsxs("div", { className: "card", style: { marginBottom: 16 }, children: [_jsxs("div", { className: "job-card", children: [_jsxs("div", { className: "job-info", children: [_jsx("div", { className: "job-title", children: job.title }), _jsx("div", { className: "job-company", children: job.company }), _jsxs("div", { className: "job-meta", children: [job.location && _jsx("span", { children: job.location }), salary && _jsx("span", { children: salary }), job.source && _jsxs("span", { children: ["via ", job.source] })] }), _jsxs("div", { className: "job-skills", children: [skill_matches.map(s => _jsx("span", { className: "pill pill-green", children: s }, s)), skill_gaps.map(s => _jsx("span", { className: "pill pill-red", children: s }, s))] })] }), _jsx(ScoreRing, { score: score })] }), recommendation && (_jsx("p", { style: { marginTop: 12, fontSize: 13, color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 12 }, children: recommendation })), !applied && onApply && (_jsxs("div", { style: { marginTop: 14 }, children: [_jsx("button", { className: "btn btn-primary btn-sm", onClick: () => onApply(match.id), children: "Apply" }), job.url && job.url !== '#' && (_jsx("a", { href: job.url, target: "_blank", rel: "noreferrer", className: "btn btn-outline btn-sm", style: { marginLeft: 8 }, children: "View \u2192" }))] })), applied && (_jsxs("div", { style: { marginTop: 12 }, children: [_jsx("span", { className: "pill pill-green", children: "Applied" }), match.status === 'interview' && _jsx("span", { className: "pill pill-amber", style: { marginLeft: 6 }, children: "Interview" })] }))] }));
}
