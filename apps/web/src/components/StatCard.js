import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function StatCard({ value, label, sub }) {
    return (_jsxs("div", { className: "card stat-card", children: [_jsx("div", { className: "stat-value", children: value }), _jsx("div", { className: "stat-label", children: label }), sub && _jsx("div", { className: "text-sm text-muted", children: sub })] }));
}
