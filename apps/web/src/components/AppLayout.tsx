import { NavLink, Outlet } from 'react-router'
import { useAuth } from '../lib/auth'

const navItems = [
  { to: '/app/today',        label: 'Today',        icon: '◎' },
  { to: '/app/matches',      label: 'Matches',      icon: '✦' },
  { to: '/app/applications', label: 'Applications', icon: '📋' },
  { to: '/app/cv-lab',       label: 'CV Lab',       icon: '📄' },
  { to: '/app/settings',     label: 'Settings',     icon: '⚙' },
]

export function AppLayout() {
  const { signOut, user } = useAuth()

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar-logo">
          <span>FEN</span>
        </div>
        {navItems.map(n => (
          <NavLink
            key={n.to}
            to={n.to}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <span>{n.icon}</span>
            <span>{n.label}</span>
          </NavLink>
        ))}
        <div className="sidebar-spacer" />
        {user && (
          <div style={{ padding: '0 8px' }}>
            <div className="text-sm text-muted" style={{ marginBottom: 8, wordBreak: 'break-all' }}>{user.email}</div>
            <button className="btn btn-outline btn-sm w-full" onClick={signOut}>Sign out</button>
          </div>
        )}
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
