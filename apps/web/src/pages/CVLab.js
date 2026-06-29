import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { api } from '../lib/api';
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain'];
const ACCEPTED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt'];
const MAX_BYTES = 2 * 1024 * 1024;
function validateFile(file) {
    if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXT.some(e => file.name.toLowerCase().endsWith(e)))
        return `Unsupported format. Please upload: ${ACCEPTED_EXT.join(', ')}`;
    if (file.size > MAX_BYTES)
        return 'File is too large — maximum 2 MB';
    return null;
}
export function CVLab() {
    const [profile, setProfile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef(null);
    const handleFile = async (file) => {
        const err = validateFile(file);
        if (err) {
            setError(err);
            return;
        }
        setUploading(true);
        setError('');
        setSuccess(false);
        try {
            const p = await api.uploadCV(file);
            setProfile(p);
            setSuccess(true);
        }
        catch (e) {
            setError(e instanceof Error ? e.message : 'Upload failed');
        }
        finally {
            setUploading(false);
        }
    };
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "CV Lab" }), _jsx("p", { className: "page-sub", children: "Upload your CV to update your profile and improve match quality." })] }), _jsxs("div", { className: "card", style: { maxWidth: 520 }, children: [_jsx("h3", { style: { marginBottom: 16 }, children: "Upload CV" }), error && _jsx("div", { className: "banner banner-danger mb-4", children: error }), success && _jsx("div", { className: "banner banner-success mb-4", children: "CV parsed \u2014 your profile has been updated." }), _jsxs("div", { style: {
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
                                handleFile(f);
                        }, children: [_jsx(Upload, { size: 28, strokeWidth: 1.5, style: { color: 'var(--text-faint)', marginBottom: 10 } }), _jsx("div", { className: "font-medium", children: "Drop your CV here or click to browse" }), _jsx("div", { className: "text-sm text-muted", style: { marginTop: 4 }, children: "PDF, PNG, JPG, GIF, WebP, TXT \u00B7 max 2 MB" }), uploading && _jsx("div", { className: "spinner", style: { margin: '12px auto 0' } })] }), _jsx("input", { ref: inputRef, type: "file", accept: ACCEPTED_EXT.join(','), style: { display: 'none' }, onChange: e => { const f = e.target.files?.[0]; if (f)
                            handleFile(f); } })] }), profile && (_jsxs("div", { className: "card", style: { maxWidth: 520, marginTop: 16 }, children: [_jsx("h3", { style: { marginBottom: 16 }, children: "Parsed profile" }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 10 }, children: [profile.full_name && _jsx(Row, { label: "Name", children: profile.full_name }), profile.headline && _jsx(Row, { label: "Headline", children: profile.headline }), profile.experience_years && _jsxs(Row, { label: "Experience", children: [profile.experience_years, " years"] }), profile.location && _jsx(Row, { label: "Location", children: profile.location }), profile.skills.length > 0 && (_jsxs("div", { children: [_jsx("div", { className: "field-label", style: { marginBottom: 6 }, children: "Skills" }), _jsx("div", { className: "job-tags", children: profile.skills.map(s => _jsx("span", { className: "badge badge-success", children: s }, s)) })] }))] })] }))] }));
}
function Row({ label, children }) {
    return (_jsxs("div", { style: { display: 'flex', gap: 12 }, children: [_jsx("span", { className: "text-muted text-sm", style: { width: 90, flexShrink: 0 }, children: label }), _jsx("span", { className: "text-sm", children: children })] }));
}
