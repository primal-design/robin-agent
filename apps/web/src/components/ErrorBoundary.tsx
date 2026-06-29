import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#faf9f6' }}>
        <div style={{ maxWidth: 480, padding: 32, background: '#fff', borderRadius: 14, border: '1px solid #e5e1d8' }}>
          <h2 style={{ marginBottom: 8, fontFamily: 'Inter, sans-serif' }}>Something went wrong</h2>
          <p style={{ color: '#6b6b6b', fontSize: 14, marginBottom: 16 }}>
            The app crashed. Try refreshing the page. If it keeps happening, sign out and back in.
          </p>
          <pre style={{ fontSize: 12, background: '#fef2f2', color: '#dc2626', padding: 12, borderRadius: 8, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
            {this.state.error.message}
          </pre>
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button onClick={() => window.location.reload()} style={{ padding: '8px 16px', background: '#2f6fdd', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
              Refresh
            </button>
            <button onClick={() => { localStorage.clear(); window.location.href = '/sign-in' }} style={{ padding: '8px 16px', background: '#f3f1ea', color: '#1a1a1a', border: '1px solid #e5e1d8', borderRadius: 8, cursor: 'pointer', fontSize: 14 }}>
              Sign out & retry
            </button>
          </div>
        </div>
      </div>
    )
    return this.props.children
  }
}
