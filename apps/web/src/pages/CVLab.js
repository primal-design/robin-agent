import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useRef } from 'react';
import { api } from '../lib/api';
export function CVLab() {
    const [profile, setProfile] = useState(null);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const inputRef = useRef(null);
    const handleFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        setUploading(true);
        setError('');
        setSuccess(false);
        try {
            const p = await api.uploadCV(file);
            setProfile(p);
            setSuccess(true);
        }
        catch (err) {
            setError(err instanceof Error ? err.message : 'Upload failed');
        }
        finally {
            setUploading(false);
        }
    };
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "CV Lab" }), _jsx("p", { className: "page-subtitle", children: "Upload your CV to update your profile and improve match quality." })] }), _jsxs("div", { className: "card", style: { maxWidth: 520 }, children: [_jsx("h3", { style: { fontFamily: 'Georgia, serif', marginBottom: 16 }, children: "Upload CV" }), error && _jsx("div", { className: "error-box", style: { marginBottom: 16 }, children: error }), success && (_jsx("div", { style: { padding: '12px 16px', background: 'var(--green-light)', borderRadius: 8, marginBottom: 16, color: 'var(--green)', fontSize: 13 }, children: "CV parsed successfully. Your profile has been updated." })), _jsxs("div", { style: {
                            border: '2px dashed var(--border)',
                            borderRadius: 10,
                            padding: '40px 20px',
                            textAlign: 'center',
                            cursor: 'pointer',
                            transition: 'border-color .15s',
                        }, onClick: () => inputRef.current?.click(), onDragOver: e => e.preventDefault(), onDrop: e => {
                            e.preventDefault();
                            const file = e.dataTransfer.files[0];
                            if (file) {
                                const dt = new DataTransfer();
                                dt.items.add(file);
                                if (inputRef.current) {
                                    inputRef.current.files = dt.files;
                                    inputRef.current.dispatchEvent(new Event('change', { bubbles: true }));
                                }
                            }
                        }, children: [_jsx("div", { style: { fontSize: 32, marginBottom: 8 }, children: "\uD83D\uDCC4" }), _jsx("div", { style: { fontWeight: 500 }, children: "Drop your CV here or click to browse" }), _jsx("div", { className: "text-sm text-muted", style: { marginTop: 4 }, children: "PDF or DOCX, up to 5 MB" }), uploading && _jsx("div", { className: "spinner", style: { margin: '12px auto 0' } })] }), _jsx("input", { ref: inputRef, type: "file", accept: ".pdf,.doc,.docx", style: { display: 'none' }, onChange: handleFile })] }), profile && (_jsxs("div", { className: "card", style: { maxWidth: 520, marginTop: 20 }, children: [_jsx("h3", { style: { fontFamily: 'Georgia, serif', marginBottom: 16 }, children: "Parsed profile" }), _jsxs("div", { style: { display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }, children: [profile.full_name && _jsxs("div", { children: [_jsx("span", { className: "text-muted", children: "Name: " }), profile.full_name] }), profile.headline && _jsxs("div", { children: [_jsx("span", { className: "text-muted", children: "Headline: " }), profile.headline] }), profile.experience_years && _jsxs("div", { children: [_jsx("span", { className: "text-muted", children: "Experience: " }), profile.experience_years, " years"] }), profile.location && _jsxs("div", { children: [_jsx("span", { className: "text-muted", children: "Location: " }), profile.location] }), profile.skills.length > 0 && (_jsxs("div", { children: [_jsx("div", { className: "text-muted", style: { marginBottom: 6 }, children: "Skills:" }), _jsx("div", { className: "job-skills", children: profile.skills.map(s => _jsx("span", { className: "pill pill-green", children: s }, s)) })] }))] })] }))] }));
}
