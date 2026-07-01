import { useEffect, useState, useRef } from 'react'
import { Upload } from 'lucide-react'
import type { UserProfile } from '../lib/types'
import { api } from '../lib/api'

const ACCEPTED_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']
const ACCEPTED_EXT   = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt']
const MAX_BYTES      = 2 * 1024 * 1024

function formatUploadError(message: string) {
  if (message.includes('profile_not_found')) return 'Upload a CV first to create the candidate profile.'
  if (message.includes('Internal server error') || message === '500' || message.startsWith('500 ')) {
    return 'The server could not process this CV just now. Try again in a moment, or check the Render logs if it keeps happening.'
  }
  return message
}

function validateFile(file: File): string | null {
  if (!ACCEPTED_TYPES.includes(file.type) && !ACCEPTED_EXT.some(e => file.name.toLowerCase().endsWith(e)))
    return `Unsupported format. Please upload: ${ACCEPTED_EXT.join(', ')}`
  if (file.size > MAX_BYTES)
    return 'File is too large — maximum 2 MB'
  return null
}

export function CVLab() {
  const [profile, setProfile]   = useState<UserProfile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError]       = useState('')
  const [success, setSuccess]   = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.getProfile()
      .then(p => setProfile(p))
      .catch(() => setProfile(null))
  }, [])

  const handleFile = async (file: File) => {
    const err = validateFile(file)
    if (err) { setError(err); return }
    setUploading(true)
    setError('')
    setSuccess(false)
    try {
      const p = await api.uploadCV(file)
      setProfile(p)
      setSuccess(true)
    } catch (e) {
      setError(formatUploadError(e instanceof Error ? e.message : 'Upload failed'))
    } finally {
      setUploading(false)
    }
  }

  const handleReset = async () => {
    setResetting(true)
    setError('')
    setSuccess(false)
    try {
      await api.clearProfile()
      setProfile(null)
      setSuccess(true)
    } catch (e) {
      setError(formatUploadError(e instanceof Error ? e.message : 'Reset failed'))
    } finally {
      setResetting(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">CV Lab</h1>
        <p className="page-sub">Manage the current candidate, replace an outdated CV, or clear everything and start with a new person cleanly.</p>
      </div>

      <div className="auth-panel-grid" style={{ alignItems: 'start' }}>
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>{profile ? 'Replace CV' : 'Upload CV'}</h3>
          <p className="text-sm text-muted" style={{ marginBottom: 16 }}>
            {profile
              ? 'Uploading a new CV clears your existing matches, applications, and tailored documents before rebuilding your profile.'
              : 'Start here. Once your CV is uploaded, FEN will build your profile and begin matching jobs.'}
          </p>

          {error   && <div className="banner banner-danger mb-4">{error}</div>}
          {success && <div className="banner banner-success mb-4">{profile ? 'CV parsed — your profile has been updated.' : 'Candidate data cleared. You can upload a fresh CV now.'}</div>}

          <div
            className={`dropzone${dragOver ? ' dragover' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => {
              e.preventDefault()
              setDragOver(false)
              const f = e.dataTransfer.files[0]
              if (f) handleFile(f)
            }}
          >
            <Upload size={28} strokeWidth={1.5} style={{ color: 'var(--text-faint)', marginBottom: 10 }} />
            <div className="font-medium">Drop your CV here or click to browse</div>
            <div className="text-sm text-muted" style={{ marginTop: 4 }}>
              PDF, PNG, JPG, GIF, WebP, TXT · max 2 MB
            </div>
            {uploading && <div className="spinner" style={{ margin: '12px auto 0' }} />}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_EXT.join(',')}
            style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }}
          />

          {profile && (
            <button
              className="btn btn-secondary w-full mt-4"
              disabled={resetting || uploading}
              onClick={handleReset}
            >
              {resetting ? <span className="spinner" /> : 'Clear this candidate and start fresh'}
            </button>
          )}
        </div>

        <div className="card-tinted surface-stack">
          <div className="section-title">Current state</div>
          <div>
            <h3 style={{ fontSize: 18, marginBottom: 6 }}>{profile ? 'Existing candidate loaded' : 'No candidate profile yet'}</h3>
            <p className="text-sm text-muted">
              {profile
                ? 'Use replace when the same person has a newer CV. Use clear when switching to a completely different candidate.'
                : 'Upload a CV first to create a profile, unlock matching, and enable review tools.'}
            </p>
          </div>
          <div>
            <h3 style={{ fontSize: 18, marginBottom: 6 }}>What gets cleared</h3>
            <p className="text-sm text-muted">Matches, applications, and generated CV or cover letter documents tied to the current candidate.</p>
          </div>
        </div>
      </div>

      {profile && (
        <div className="card" style={{ maxWidth: 520, marginTop: 16 }}>
          <h3 style={{ marginBottom: 16 }}>Parsed profile</h3>
          <div className="profile-grid">
            {profile.full_name && <Row label="Name">{profile.full_name}</Row>}
            {profile.headline  && <Row label="Headline">{profile.headline}</Row>}
            {profile.experience_years && <Row label="Experience">{profile.experience_years} years</Row>}
            {profile.location  && <Row label="Location">{profile.location}</Row>}
            {profile.skills.length > 0 && (
              <div>
                <div className="profile-label" style={{ marginBottom: 6 }}>Skills</div>
                <div className="job-tags">
                  {profile.skills.map(s => <span key={s} className="badge badge-success">{s}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="profile-row">
      <span className="profile-label">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  )
}
