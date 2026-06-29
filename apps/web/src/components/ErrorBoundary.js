import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Component } from 'react';
export class ErrorBoundary extends Component {
    constructor() {
        super(...arguments);
        this.state = { error: null };
    }
    static getDerivedStateFromError(error) {
        return { error };
    }
    render() {
        if (this.state.error)
            return (_jsx("div", { style: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf9f6' }, children: _jsxs("div", { style: { maxWidth: 480, padding: 32, background: '#fff', borderRadius: 14, border: '1px solid #e5e1d8' }, children: [_jsx("h2", { style: { marginBottom: 8, fontFamily: 'Inter, sans-serif' }, children: "Something went wrong" }), _jsx("p", { style: { color: '#6b6b6b', fontSize: 14, marginBottom: 16 }, children: "The app crashed. Try refreshing the page. If it keeps happening, sign out and back in." }), _jsx("pre", { style: { fontSize: 12, background: '#fef2f2', color: '#dc2626', padding: 12, borderRadius: 8, overflowX: 'auto', whiteSpace: 'pre-wrap' }, children: this.state.error.message }), _jsxs("div", { style: { marginTop: 16, display: 'flex', gap: 8 }, children: [_jsx("button", { onClick: () => window.location.reload(), style: { padding: '8px 16px', background: '#2f6fdd', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }, children: "Refresh" }), _jsx("button", { onClick: () => { localStorage.clear(); window.location.href = '/sign-in'; }, style: { padding: '8px 16px', background: '#f3f1ea', color: '#1a1a1a', border: '1px solid #e5e1d8', borderRadius: 8, cursor: 'pointer', fontSize: 14 }, children: "Sign out & retry" })] })] }) }));
        return this.props.children;
    }
}
