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
        api.getProfile().then(p => {
            setProfile(p);
            setForm(p ?? {});
        }).catch(e => setError(e.message));
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
        catch (e) {
            setError(e instanceof Error ? e.message : 'Save failed');
        }
        finally {
            setSaving(false);
        }
    };
    const genToken = async () => {
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
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "Settings" }), _jsx("p", { className: "page-sub", children: "Keep only the profile details that improve matching." })] }), error && _jsx("div", { className: "banner banner-danger mb-4", children: error }), _jsxs("div", { className: "settings-grid", children: [_jsxs("form", { onSubmit: save, style: { display: 'flex', flexDirection: 'column', gap: 20 }, children: [_jsxs("div", { className: "card settings-panel", style: { display: 'flex', flexDirection: 'column', gap: 16 }, children: [_jsx("h3", { children: "Profile" }), _jsxs("div", { className: "field", children: [_jsx("label", { className: "field-label", children: "Full name" }), _jsx("input", { className: "field-input", value: form.full_name ?? '', onChange: set('full_name') })] }), _jsxs("div", { className: "field", children: [_jsx("label", { className: "field-label", children: "Headline" }), _jsx("input", { className: "field-input", placeholder: "e.g. Senior Full Stack Engineer", value: form.headline ?? '', onChange: set('headline') })] }), _jsxs("div", { className: "field", children: [_jsx("label", { className: "field-label", children: "Location" }), _jsx("input", { className: "field-input", placeholder: "e.g. London, UK", value: form.location ?? '', onChange: set('location') })] }), _jsxs("div", { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }, children: [_jsxs("div", { className: "field", children: [_jsx("label", { className: "field-label", children: "Seniority" }), _jsxs("select", { className: "field-select", value: form.seniority ?? '', onChange: set('seniority'), children: [_jsx("option", { value: "", children: "Select\u2026" }), SENIORITIES.map(s => _jsx("option", { value: s, children: s.charAt(0).toUpperCase() + s.slice(1) }, s))] })] }), _jsxs("div", { className: "field", children: [_jsx("label", { className: "field-label", children: "Work type" }), _jsxs("select", { className: "field-select", value: form.work_type ?? '', onChange: set('work_type'), children: [_jsx("option", { value: "", children: "Select\u2026" }), WORK_TYPES.map(t => _jsx("option", { value: t, children: t.charAt(0).toUpperCase() + t.slice(1) }, t))] })] })] })] }), saved && _jsx("div", { className: "banner banner-success", children: "Saved." }), _jsx("button", { type: "submit", className: "btn btn-primary", disabled: saving || !profile, children: saving ? _jsx("span", { className: "spinner" }) : 'Save changes' })] }), _jsxs("div", { className: "card settings-panel", children: [_jsx("h3", { style: { marginBottom: 4 }, children: "Connect Telegram" }), _jsx("p", { className: "text-sm text-muted", style: { marginBottom: 16 }, children: "Optional. Only use this if you actually want job alerts in Telegram." }), telegramToken ? (_jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: [_jsx("div", { className: "field-input", style: { fontFamily: 'monospace', fontSize: 13, color: 'var(--success)' }, children: telegramToken }), _jsxs("p", { className: "text-sm text-muted", children: ["Open the FEN bot and send: ", _jsxs("code", { style: { fontFamily: 'monospace', fontSize: 12 }, children: ["/connect ", telegramToken] })] })] })) : (_jsx("button", { className: "btn btn-secondary", onClick: genToken, disabled: genningToken, children: genningToken ? _jsx("span", { className: "spinner" }) : 'Generate connect code' }))] })] })] }));
}
