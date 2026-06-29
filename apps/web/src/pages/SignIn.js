import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { useAuth } from '../lib/auth';
export function SignIn() {
    const { signIn } = useAuth();
    const [email, setEmail] = useState('');
    const [sent, setSent] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const submit = async (e) => {
        e.preventDefault();
        if (!email.trim())
            return;
        setLoading(true);
        setError('');
        try {
            await signIn(email.trim());
            setSent(true);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Something went wrong');
        }
        finally {
            setLoading(false);
        }
    };
    return (_jsx("div", { className: "auth-page", children: _jsxs("div", { className: "card auth-card", children: [_jsx("h1", { children: "Sign in to FEN" }), _jsx("p", { className: "auth-sub", children: "We'll send a magic link to your email \u2014 no password needed." }), sent ? (_jsxs("div", { style: { textAlign: 'center', padding: '24px 0' }, children: [_jsx("div", { style: { fontSize: 36, marginBottom: 12 }, children: "\uD83D\uDCEC" }), _jsx("h3", { style: { marginBottom: 8 }, children: "Check your inbox" }), _jsxs("p", { className: "text-muted text-sm", children: ["Sent a sign-in link to ", _jsx("strong", { children: email })] })] })) : (_jsxs("form", { onSubmit: submit, style: { display: 'flex', flexDirection: 'column', gap: 16 }, children: [error && _jsx("div", { className: "banner banner-danger", children: error }), _jsxs("div", { className: "field", children: [_jsx("label", { className: "field-label", children: "Email address" }), _jsx("input", { type: "email", className: "field-input", placeholder: "you@example.com", value: email, onChange: e => setEmail(e.target.value), required: true, autoFocus: true })] }), _jsx("button", { type: "submit", className: "btn btn-primary w-full", disabled: loading, children: loading ? _jsx("span", { className: "spinner" }) : 'Send magic link' })] }))] }) }));
}
