import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function ScoreRing({ score, size = 52 }) {
    const r = (size - 6) / 2;
    const circ = 2 * Math.PI * r;
    const fill = (score / 100) * circ;
    const color = score >= 80 ? '#079455' : score >= 60 ? '#d97706' : '#dc2626';
    return (_jsxs("div", { className: "score-ring", style: { width: size, height: size }, children: [_jsxs("svg", { width: size, height: size, children: [_jsx("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", stroke: "#e8e4dc", strokeWidth: 5 }), _jsx("circle", { cx: size / 2, cy: size / 2, r: r, fill: "none", stroke: color, strokeWidth: 5, strokeDasharray: `${fill} ${circ}`, strokeLinecap: "round" })] }), _jsx("span", { className: "score-text", children: score })] }));
}
