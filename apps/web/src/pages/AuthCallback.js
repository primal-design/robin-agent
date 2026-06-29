import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../lib/auth';
export function AuthCallback() {
    const [params] = useSearchParams();
    const { setTokenFromCallback } = useAuth();
    const navigate = useNavigate();
    const [error, setError] = useState('');
    useEffect(() => {
        const token = params.get('token');
        if (!token) {
            setError('No token found in URL');
            return;
        }
        setTokenFromCallback(token)
            .then(() => navigate('/app/today', { replace: true }))
            .catch(e => setError(e instanceof Error ? e.message : 'Auth failed'));
    }, []);
    if (error)
        return (_jsx("div", { className: "auth-page", children: _jsxs("div", { className: "card auth-card", children: [_jsx("div", { className: "error-box", children: error }), _jsx("a", { href: "/sign-in", className: "btn btn-outline w-full", style: { marginTop: 16 }, children: "Back to sign in" })] }) }));
    return (_jsx("div", { className: "auth-page", children: _jsxs("div", { style: { textAlign: 'center', color: 'var(--muted)' }, children: [_jsx("div", { className: "spinner", style: { margin: '0 auto 12px' } }), "Signing you in\u2026"] }) }));
}
