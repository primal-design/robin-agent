import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ProgressRing({ value, size = 52, strokeWidth = 5 }) {
    const r = (size - strokeWidth) / 2;
    const circ = 2 * Math.PI * r;
    const fill = (Math.min(100, Math.max(0, value)) / 100) * circ;
    const color = value >= 80 ? 'var(--success)' : value >= 60 ? 'var(--warning)' : 'var(--danger)';
    return (_jsxs("div", { className: "progress-ring", style: { width: size, height: size }, children: [_jsxs("svg", { width: size, height: size, children: [_jsx("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", stroke: "var(--surface-1)", strokeWidth: strokeWidth }), _jsx("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", stroke: color, strokeWidth: strokeWidth, strokeDasharray: `${fill} ${circ}`, strokeLinecap: "round" })] }), _jsx("span", { className: "ring-label", children: value })] }));
}
