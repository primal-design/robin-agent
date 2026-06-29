import { NavLink, Outlet } from 'react-router'
import { LayoutDashboard, Sparkles, ClipboardList, FileText, Settings } from 'lucide-react'
import { useAuth } from '../lib/auth'

const navItems = [
  { to: '/app/today',        label: 'Today',        Icon: LayoutDashboard },
  { to: '/app/matches',      label: 'Matches',      Icon: Sparkles },
  { to: '/app/applications', label: 'Applications', Icon: ClipboardList },
  { to: '/app/cv-lab',       label: 'CV Lab',       Icon: FileText },
  { to: '/app/settings',     label: 'Settings',     Icon: Settings },
]

export function AppLayout() {
  const { signOut, user } = useAuth()

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar-logo">FEN</div>

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
          <div style={{ padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="text-xs text-muted" style={{ wordBreak: 'break-all' }}>{user.email}</div>
            <button className="btn btn-ghost btn-sm w-full" style={{ justifyContent: 'flex-start' }} onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </nav>

      <main className="main-content">
        <Outlet />
      </main>
    </div>
  )
}
