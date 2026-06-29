import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { JobCard } from '../components/JobCard';
export function Matches() {
    const [matches, setMatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => {
        api.getMatches()
            .then(setMatches)
            .catch(e => setError(e.message))
            .finally(() => setLoading(false));
    }, []);
    if (loading)
        return _jsx("div", { className: "text-muted", children: "Loading\u2026" });
    if (error)
        return _jsx("div", { className: "error-box", children: error });
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "Matches" }), _jsxs("p", { className: "page-subtitle", children: [matches.length, " job", matches.length !== 1 ? 's' : '', " matched to your profile"] })] }), matches.length === 0 ? (_jsxs("div", { className: "empty-state", children: [_jsx("h3", { children: "No matches yet" }), _jsx("p", { children: "FEN will find jobs when it next scans. Check back soon." })] })) : (matches.map(m => (_jsx(JobCard, { match: m }, m.id))))] }));
}
