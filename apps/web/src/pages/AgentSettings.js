import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
const WORK_TYPES = ['remote', 'hybrid', 'onsite', 'any'];
const SENIORITIES = ['junior', 'mid', 'senior', 'lead', 'principal'];
export function AgentSettings() {
    const [profile, setProfile] = useState(null);
    const [form, setForm] = useState({});
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const [telegramToken, setTelegramToken] = useState('');
    const [genningToken, setGenningToken] = useState(false);
    useEffect(() => {
        api.getProfile().then(p => { setProfile(p); setForm(p); }).catch(e => setError(e.message));
    }, []);
    const save = async (e) => {
        e.preventDefault();
        setSaving(true);
        setSaved(false);
        try {
            const updated = await api.updateProfile(form);
            setProfile(updated);
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Save failed');
        }
        finally {
            setSaving(false);
        }
    };
    const genTelegramToken = async () => {
        setGenningToken(true);
        try {
            const { token } = await api.generateTelegramToken();
            setTelegramToken(token);
        }
        catch { /* ignore */ }
        finally {
            setGenningToken(false);
        }
    };
    const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "Settings" }), _jsx("p", { className: "page-subtitle", children: "Configure your job search preferences." })] }), error && _jsx("div", { className: "error-box", style: { marginBottom: 20 }, children: error }), _jsxs("form", { onSubmit: save, style: { maxWidth: 520, display: 'flex', flexDirection: 'column', gap: 20 }, children: [_jsxs("div", { className: "card", style: { display: 'flex', flexDirection: 'column', gap: 16 }, children: [_jsx("h3", { style: { fontFamily: 'Georgia, serif' }, children: "Profile" }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Full name" }), _jsx("input", { className: "form-input", value: form.full_name ?? '', onChange: set('full_name') })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Headline" }), _jsx("input", { className: "form-input", placeholder: "e.g. Senior Full Stack Engineer", value: form.headline ?? '', onChange: set('headline') })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Location" }), _jsx("input", { className: "form-input", placeholder: "e.g. London, UK", value: form.location ?? '', onChange: set('location') })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }, children: [_jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Seniority" }), _jsxs("select", { className: "form-input", value: form.seniority ?? '', onChange: set('seniority'), children: [_jsx("option", { value: "", children: "Select\u2026" }), SENIORITIES.map(s => _jsx("option", { value: s, children: s.charAt(0).toUpperCase() + s.slice(1) }, s))] })] }), _jsxs("div", { className: "form-group", children: [_jsx("label", { className: "form-label", children: "Work type" }), _jsxs("select", { className: "form-input", value: form.work_type ?? '', onChange: set('work_type'), children: [_jsx("option", { value: "", children: "Select\u2026" }), WORK_TYPES.map(t => _jsx("option", { value: t, children: t.charAt(0).toUpperCase() + t.slice(1) }, t))] })] })] })] }), saved && (_jsx("div", { style: { padding: '10px 14px', background: 'var(--green-light)', borderRadius: 8, color: 'var(--green)', fontSize: 13 }, children: "Saved successfully." })), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: saving || !profile, children: saving ? _jsx("span", { className: "spinner" }) : 'Save changes' })] }), _jsxs("div", { className: "card", style: { maxWidth: 520, marginTop: 24 }, children: [_jsx("h3", { style: { fontFamily: 'Georgia, serif', marginBottom: 12 }, children: "Connect Telegram" }), _jsx("p", { className: "text-sm text-muted", style: { marginBottom: 16 }, children: "Get job matches and alerts sent directly to your Telegram account." }), telegramToken ? (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: [_jsx("div", { className: "form-input", style: { fontFamily: 'monospace', fontSize: 13, color: 'var(--green)' }, children: telegramToken }), _jsxs("p", { className: "text-sm text-muted", children: ["Open your FEN Telegram bot and send: ", _jsxs("code", { style: { fontFamily: 'monospace' }, children: ["/connect ", telegramToken] })] })] })) : (_jsx("button", { className: "btn btn-outline", onClick: genTelegramToken, disabled: genningToken, children: genningToken ? _jsx("span", { className: "spinner" }) : 'Generate connect code' }))] })] }));
}
