import { useState, useRef } from 'react'
import type { UserProfile } from '../lib/types'
import { api } from '../lib/api'

export function CVLab() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    setSuccess(false)
    try {
      const p = await api.uploadCV(file)
      setProfile(p)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">CV Lab</h1>
        <p className="page-subtitle">Upload your CV to update your profile and improve match quality.</p>
      </div>

      <div className="card" style={{ maxWidth: 520 }}>
        <h3 style={{ fontFamily: 'Georgia, serif', marginBottom: 16 }}>Upload CV</h3>

        {error && <div className="error-box" style={{ marginBottom: 16 }}>{error}</div>}
        {success && (
          <div style={{ padding: '12px 16px', background: 'var(--green-light)', borderRadius: 8, marginBottom: 16, color: 'var(--green)', fontSize: 13 }}>
            CV parsed successfully. Your profile has been updated.
          </div>
        )}

        <div
          style={{
            border: '2px dashed var(--border)',
            borderRadius: 10,
            padding: '40px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color .15s',
          }}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const file = e.dataTransfer.files[0]
            if (file) {
              const dt = new DataTransfer()
              dt.items.add(file)
              if (inputRef.current) { inputRef.current.files = dt.files; inputRef.current.dispatchEvent(new Event('change', { bubbles: true })) }
            }
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>📄</div>
          <div style={{ fontWeight: 500 }}>Drop your CV here or click to browse</div>
          <div className="text-sm text-muted" style={{ marginTop: 4 }}>PDF or DOCX, up to 5 MB</div>
          {uploading && <div className="spinner" style={{ margin: '12px auto 0' }} />}
        </div>

        <input ref={inputRef} type="file" accept=".pdf,.doc,.docx" style={{ display: 'none' }} onChange={handleFile} />
      </div>

      {profile && (
        <div className="card" style={{ maxWidth: 520, marginTop: 20 }}>
          <h3 style={{ fontFamily: 'Georgia, serif', marginBottom: 16 }}>Parsed profile</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 14 }}>
            {profile.full_name && <div><span className="text-muted">Name: </span>{profile.full_name}</div>}
            {profile.headline  && <div><span className="text-muted">Headline: </span>{profile.headline}</div>}
            {profile.experience_years && <div><span className="text-muted">Experience: </span>{profile.experience_years} years</div>}
            {profile.location  && <div><span className="text-muted">Location: </span>{profile.location}</div>}
            {profile.skills.length > 0 && (
              <div>
                <div className="text-muted" style={{ marginBottom: 6 }}>Skills:</div>
                <div className="job-skills">
                  {profile.skills.map(s => <span key={s} className="pill pill-green">{s}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
