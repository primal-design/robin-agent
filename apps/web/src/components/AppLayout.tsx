import { NavLink, Outlet } from 'react-router'
import { Sparkles, ClipboardList, FileText, Settings, Star } from 'lucide-react'
import { useAuth } from '../lib/auth'

const navItems = [
  { to: '/app/matches',      label: 'Matches',      Icon: Sparkles },
  { to: '/app/applications', label: 'Applications', Icon: ClipboardList },
  { to: '/app/cv-lab',       label: 'CV Lab',       Icon: FileText },
  { to: '/app/cv-review',    label: 'CV Review',    Icon: Star },
  { to: '/app/settings',     label: 'Settings',     Icon: Settings },
]

export function AppLayout() {
  const { signOut, user } = useAuth()
  const displayName = user?.email?.split('@')[0] || 'FEN user'
  const initials = displayName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join('') || 'F'

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-title">FEN</div>
          <p className="sidebar-logo-subtitle">
            Focused job search workspace for one candidate at a time.
          </p>
        </div>

        <div className="sidebar-section-label">Workspace</div>

        {navItems.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            <Icon size={16} strokeWidth={1.75} />
            <span>{label}</span>
          </NavLink>
        ))}

        <div className="sidebar-spacer" />

        {user && (
          <div className="sidebar-user">
            <div className="sidebar-user-card">
              <div className="sidebar-user-avatar">{initials}</div>
              <div className="sidebar-user-meta">
                <div className="sidebar-user-name">{displayName}</div>
                <div className="sidebar-user-email">{user.email}</div>
              </div>
            </div>
            <button className="btn btn-ghost btn-sm w-full sidebar-signout" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </nav>

      <div className="content-shell">
        <div className="mobile-nav">
          {navItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`}
            >
              <Icon size={15} strokeWidth={1.9} />
              <span>{label}</span>
            </NavLink>
          ))}
        </div>

        <main className="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
