import { useState, useRef } from 'react'
import { useNavigate } from 'react-router'
import { api } from '../lib/api'

export function Onboarding() {
  const navigate = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async () => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      await api.uploadCV(file)
      navigate('/app/today', { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1 style={{ marginBottom: 8 }}>Welcome to FEN</h1>
        <p>Upload your CV to get started. FEN will parse it, build your profile, and start finding jobs.</p>

        {error && <div className="error-box" style={{ marginTop: 16 }}>{error}</div>}

        <div
          style={{
            border: '2px dashed var(--border)',
            borderRadius: 10,
            padding: '40px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            marginTop: 24,
          }}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) setFile(f)
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }}>📄</div>
          {file ? (
            <div style={{ fontWeight: 500 }}>{file.name}</div>
          ) : (
            <>
              <div style={{ fontWeight: 500 }}>Drop your CV here or click to browse</div>
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>PDF or DOCX</div>
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.doc,.docx"
          style={{ display: 'none' }}
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />

        <button
          className="btn btn-primary w-full"
          style={{ marginTop: 20 }}
          disabled={!file || uploading}
          onClick={handleUpload}
        >
          {uploading ? <span className="spinner" /> : 'Upload & continue →'}
        </button>
      </div>
    </div>
  )
}
