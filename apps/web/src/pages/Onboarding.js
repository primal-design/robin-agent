import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Upload } from 'lucide-react';
import { api } from '../lib/api';
const ACCEPTED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt'];
export function Onboarding() {
    const navigate = useNavigate();
    const [file, setFile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [dragOver, setDragOver] = useState(false);
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
        catch (e) {
            setError(e instanceof Error ? e.message : 'Upload failed');
        }
        finally {
            setUploading(false);
        }
    };
    return (_jsx("div", { className: "auth-page", children: _jsxs("div", { className: "card auth-card", children: [_jsx("h1", { style: { marginBottom: 8 }, children: "Welcome to FEN" }), _jsx("p", { className: "auth-sub", children: "Upload your CV to get started. FEN will parse it, build your profile, and start finding jobs." }), error && _jsx("div", { className: "banner banner-danger mb-4", children: error }), _jsxs("div", { style: {
                        border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
                        background: dragOver ? 'var(--accent-light)' : 'var(--surface-1)',
                        borderRadius: 12,
                        padding: '44px 20px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'border-color .15s, background .15s',
                    }, onClick: () => inputRef.current?.click(), onDragOver: e => { e.preventDefault(); setDragOver(true); }, onDragLeave: () => setDragOver(false), onDrop: e => {
                        e.preventDefault();
                        setDragOver(false);
                        const f = e.dataTransfer.files[0];
                        if (f)
                            setFile(f);
                    }, children: [_jsx(Upload, { size: 28, strokeWidth: 1.5, style: { color: 'var(--text-faint)', marginBottom: 10 } }), file ? (_jsx("div", { className: "font-medium", children: file.name })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "font-medium", children: "Drop your CV here or click to browse" }), _jsx("div", { className: "text-sm text-muted", style: { marginTop: 4 }, children: "PDF, PNG, JPG, WebP, TXT" })] }))] }), _jsx("input", { ref: inputRef, type: "file", accept: ACCEPTED_EXT.join(','), style: { display: 'none' }, onChange: e => setFile(e.target.files?.[0] ?? null) }), _jsx("button", { className: "btn btn-primary w-full mt-5", disabled: !file || uploading, onClick: handleUpload, children: uploading ? _jsx("span", { className: "spinner" }) : 'Upload & continue →' })] }) }));
}
