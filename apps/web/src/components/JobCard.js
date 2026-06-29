import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { ProgressRing } from './ProgressRing';
function fmtSalary(min, max, currency = 'GBP') {
    if (!min)
        return null;
    const fmt = (n) => new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
    return max ? `${fmt(min)} – ${fmt(max)}` : fmt(min);
}
export function JobCard({ match, onApply }) {
    const { job, score, skill_matches, skill_gaps, applied, recommendation, status } = match;
    const salary = fmtSalary(job.salary_min, job.salary_max, job.salary_currency);
    return (_jsxs("div", { className: "card", style: { marginBottom: 12 }, children: [_jsxs("div", { className: "job-card-row", children: [_jsxs("div", { className: "job-info", children: [_jsx("div", { className: "job-title", children: job.title }), _jsx("div", { className: "job-company", children: job.company }), _jsxs("div", { className: "job-meta", children: [job.location && _jsx("span", { children: job.location }), salary && _jsx("span", { children: salary }), job.source && _jsxs("span", { children: ["via ", job.source] })] }), _jsxs("div", { className: "job-tags", children: [skill_matches.map(s => _jsx("span", { className: "badge badge-success", children: s }, s)), skill_gaps.map(s => _jsx("span", { className: "badge badge-danger", children: s }, s))] })] }), _jsx(ProgressRing, { value: score })] }), recommendation && (_jsx("p", { style: { marginTop: 12, fontSize: 13, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 12, lineHeight: 1.6 }, children: recommendation })), _jsx("div", { style: { marginTop: 14, display: 'flex', alignItems: 'center', gap: 8 }, children: applied ? (_jsxs(_Fragment, { children: [_jsx("span", { className: "badge badge-success", children: "Applied" }), status === 'interview' && _jsx("span", { className: "badge badge-warning", children: "Interview" }), status === 'offer' && _jsx("span", { className: "badge badge-accent", children: "Offer" })] })) : onApply ? (_jsxs(_Fragment, { children: [_jsx("button", { className: "btn btn-primary btn-sm", onClick: () => onApply(match.id), children: "Apply" }), job.url && job.url !== '#' && (_jsx("a", { href: job.url, target: "_blank", rel: "noreferrer", className: "btn btn-secondary btn-sm", children: "View \u2192" }))] })) : null })] }));
}
