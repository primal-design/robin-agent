import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api';
export function Onboarding() {
    const navigate = useNavigate();
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef(null);
    const handleUpload = async () => {
        if (!file)
            return;
        setUploading(true);
        setError('');
        try {
            await api.uploadCV(file);
            navigate('/app/today', { replace: true });
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
        }
        finally {
            setUploading(false);
        }
    };
    return (_jsx("div", { className: "auth-page", children: _jsxs("div", { className: "card auth-card", children: [_jsx("h1", { style: { marginBottom: 8 }, children: "Welcome to FEN" }), _jsx("p", { children: "Upload your CV to get started. FEN will parse it, build your profile, and start finding jobs." }), error && _jsx("div", { className: "error-box", style: { marginTop: 16 }, children: error }), _jsxs("div", { style: {
                        border: '2px dashed var(--border)',
                        borderRadius: 10,
                        padding: '40px 20px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        marginTop: 24,
                    }, onClick: () => inputRef.current?.click(), onDragOver: e => e.preventDefault(), onDrop: e => {
                        e.preventDefault();
                        const f = e.dataTransfer.files[0];
                        if (f)
                            setFile(f);
                    }, children: [_jsx("div", { style: { fontSize: 40, marginBottom: 8 }, children: "\uD83D\uDCC4" }), file ? (_jsx("div", { style: { fontWeight: 500 }, children: file.name })) : (_jsxs(_Fragment, { children: [_jsx("div", { style: { fontWeight: 500 }, children: "Drop your CV here or click to browse" }), _jsx("div", { className: "text-sm text-muted", style: { marginTop: 4 }, children: "PDF or DOCX" })] }))] }), _jsx("input", { ref: inputRef, type: "file", accept: ".pdf,.doc,.docx", style: { display: 'none' }, onChange: e => setFile(e.target.files?.[0] ?? null) }), _jsx("button", { className: "btn btn-primary w-full", style: { marginTop: 20 }, disabled: !file || uploading, onClick: handleUpload, children: uploading ? _jsx("span", { className: "spinner" }) : 'Upload & continue →' })] }) }));
}
