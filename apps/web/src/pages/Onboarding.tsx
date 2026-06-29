import { useState, useRef } from 'react'
import { useNavigate } from 'react-router'
import { Upload } from 'lucide-react'
import { api } from '../lib/api'

const ACCEPTED_EXT = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.txt']

export function Onboarding() {
  const navigate  = useNavigate()
  const [file, setFile]       = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError]     = useState('')
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleUpload = async () => {
    if (!file) return
    setUploading(true); setError('')
    try { await api.uploadCV(file); navigate('/app/today', { replace: true }) }
    catch (e) { setError(e instanceof Error ? e.message : 'Upload failed') }
    finally { setUploading(false) }
  }

  return (
    <div className="auth-page">
      <div className="card auth-card">
        <h1 style={{ marginBottom: 8 }}>Welcome to FEN</h1>
        <p className="auth-sub">Upload your CV to get started. FEN will parse it, build your profile, and start finding jobs.</p>

        {error && <div className="banner banner-danger mb-4">{error}</div>}

        <div
          style={{
            border: `2px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
            background: dragOver ? 'var(--accent-light)' : 'var(--surface-1)',
            borderRadius: 12,
            padding: '44px 20px',
            textAlign: 'center',
            cursor: 'pointer',
            transition: 'border-color .15s, background .15s',
          }}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => {
            e.preventDefault(); setDragOver(false)
            const f = e.dataTransfer.files[0]; if (f) setFile(f)
          }}
        >
          <Upload size={28} strokeWidth={1.5} style={{ color: 'var(--text-faint)', marginBottom: 10 }} />
          {file ? (
            <div className="font-medium">{file.name}</div>
          ) : (
            <>
              <div className="font-medium">Drop your CV here or click to browse</div>
              <div className="text-sm text-muted" style={{ marginTop: 4 }}>PDF, PNG, JPG, WebP, TXT</div>
            </>
          )}
        </div>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_EXT.join(',')}
          style={{ display: 'none' }}
          onChange={e => setFile(e.target.files?.[0] ?? null)}
        />

        <button
          className="btn btn-primary w-full mt-5"
          disabled={!file || uploading}
          onClick={handleUpload}
        >
          {uploading ? <span className="spinner" /> : 'Upload & continue →'}
        </button>
      </div>
    </div>
  )
}
