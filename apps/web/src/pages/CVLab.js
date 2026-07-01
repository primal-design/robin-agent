import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState, useRef } from 'react';
import { Upload } from 'lucide-react';
import { api } from '../lib/api';
const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain'];
const ACCEPTED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt'];
const MAX_BYTES = 2 * 1024 * 1024;
function formatUploadError(message) {
    if (message.includes('profile_not_found'))
        return 'Upload a CV first to create the candidate profile.';
    if (message.includes('Internal server error') || message === '500' || message.startsWith('500 ')) {
        return 'The server could not process this CV just now. Try again in a moment, or check the Render logs if it keeps happening.';
    }
    return message;
}
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
    const [resetting, setResetting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef(null);
    useEffect(() => {
        api.getProfile()
            .then(p => setProfile(p))
            .catch(() => setProfile(null));
    }, []);
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
            setError(formatUploadError(e instanceof Error ? e.message : 'Upload failed'));
        }
        finally {
            setUploading(false);
        }
    };
    const handleReset = async () => {
        setResetting(true);
        setError('');
        setSuccess(false);
        try {
            await api.clearProfile();
            setProfile(null);
            setSuccess(true);
        }
        catch (e) {
            setError(formatUploadError(e instanceof Error ? e.message : 'Reset failed'));
        }
        finally {
            setResetting(false);
        }
    };
    return (_jsxs("div", { children: [_jsxs("div", { className: "page-header", children: [_jsx("h1", { className: "page-title", children: "CV Lab" }), _jsx("p", { className: "page-sub", children: "Manage the current candidate, replace an outdated CV, or clear everything and start with a new person cleanly." })] }), _jsxs("div", { className: "auth-panel-grid", style: { alignItems: 'start' }, children: [_jsxs("div", { className: "card", children: [_jsx("h3", { style: { marginBottom: 8 }, children: profile ? 'Replace CV' : 'Upload CV' }), _jsx("p", { className: "text-sm text-muted", style: { marginBottom: 16 }, children: profile
                                    ? 'Uploading a new CV clears your existing matches, applications, and tailored documents before rebuilding your profile.'
                                    : 'Start here. Once your CV is uploaded, FEN will build your profile and begin matching jobs.' }), error && _jsx("div", { className: "banner banner-danger mb-4", children: error }), success && _jsx("div", { className: "banner banner-success mb-4", children: profile ? 'CV parsed — your profile has been updated.' : 'Candidate data cleared. You can upload a fresh CV now.' }), _jsxs("div", { className: `dropzone${dragOver ? ' dragover' : ''}`, onClick: () => inputRef.current?.click(), onDragOver: e => { e.preventDefault(); setDragOver(true); }, onDragLeave: () => setDragOver(false), onDrop: e => {
                                    e.preventDefault();
                                    setDragOver(false);
                                    const f = e.dataTransfer.files[0];
                                    if (f)
                                        handleFile(f);
                                }, children: [_jsx(Upload, { size: 28, strokeWidth: 1.5, style: { color: 'var(--text-faint)', marginBottom: 10 } }), _jsx("div", { className: "font-medium", children: "Drop your CV here or click to browse" }), _jsx("div", { className: "text-sm text-muted", style: { marginTop: 4 }, children: "PDF, PNG, JPG, GIF, WebP, TXT \u00B7 max 2 MB" }), uploading && _jsx("div", { className: "spinner", style: { margin: '12px auto 0' } })] }), _jsx("input", { ref: inputRef, type: "file", accept: ACCEPTED_EXT.join(','), style: { display: 'none' }, onChange: e => { const f = e.target.files?.[0]; if (f)
                                    handleFile(f); } }), profile && (_jsx("button", { className: "btn btn-secondary w-full mt-4", disabled: resetting || uploading, onClick: handleReset, children: resetting ? _jsx("span", { className: "spinner" }) : 'Clear this candidate and start fresh' }))] }), _jsxs("div", { className: "card-tinted surface-stack", children: [_jsx("div", { className: "section-title", children: "Current state" }), _jsxs("div", { children: [_jsx("h3", { style: { fontSize: 18, marginBottom: 6 }, children: profile ? 'Existing candidate loaded' : 'No candidate profile yet' }), _jsx("p", { className: "text-sm text-muted", children: profile
                                            ? 'Use replace when the same person has a newer CV. Use clear when switching to a completely different candidate.'
                                            : 'Upload a CV first to create a profile, unlock matching, and enable review tools.' })] }), _jsxs("div", { children: [_jsx("h3", { style: { fontSize: 18, marginBottom: 6 }, children: "What gets cleared" }), _jsx("p", { className: "text-sm text-muted", children: "Matches, applications, and generated CV or cover letter documents tied to the current candidate." })] })] })] }), profile && (_jsxs("div", { className: "card", style: { maxWidth: 520, marginTop: 16 }, children: [_jsx("h3", { style: { marginBottom: 16 }, children: "Parsed profile" }), _jsxs("div", { className: "profile-grid", children: [profile.full_name && _jsx(Row, { label: "Name", children: profile.full_name }), profile.headline && _jsx(Row, { label: "Headline", children: profile.headline }), profile.experience_years && _jsxs(Row, { label: "Experience", children: [profile.experience_years, " years"] }), profile.location && _jsx(Row, { label: "Location", children: profile.location }), profile.skills.length > 0 && (_jsxs("div", { children: [_jsx("div", { className: "profile-label", style: { marginBottom: 6 }, children: "Skills" }), _jsx("div", { className: "job-tags", children: profile.skills.map(s => _jsx("span", { className: "badge badge-success", children: s }, s)) })] }))] })] }))] }));
}
function Row({ label, children }) {
    return (_jsxs("div", { className: "profile-row", children: [_jsx("span", { className: "profile-label", children: label }), _jsx("span", { className: "text-sm", children: children })] }));
}
