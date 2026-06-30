import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, Outlet } from 'react-router';
import { LayoutDashboard, Sparkles, ClipboardList, FileText, Settings, Star } from 'lucide-react';
import { useAuth } from '../lib/auth';
const navItems = [
    { to: '/app/today', label: 'Today', Icon: LayoutDashboard },
    { to: '/app/matches', label: 'Matches', Icon: Sparkles },
    { to: '/app/applications', label: 'Applications', Icon: ClipboardList },
    { to: '/app/cv-lab', label: 'CV Lab', Icon: FileText },
    { to: '/app/cv-review', label: 'CV Review', Icon: Star },
    { to: '/app/settings', label: 'Settings', Icon: Settings },
];
export function AppLayout() {
    const { signOut, user } = useAuth();
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("nav", { className: "sidebar", children: [_jsx("div", { className: "sidebar-logo", children: "FEN" }), navItems.map(({ to, label, Icon }) => (_jsxs(NavLink, { to: to, className: ({ isActive }) => `nav-item${isActive ? ' active' : ''}`, children: [_jsx(Icon, { size: 16, strokeWidth: 1.75 }), _jsx("span", { children: label })] }, to))), _jsx("div", { className: "sidebar-spacer" }), user && (_jsxs("div", { style: { padding: '0 4px', display: 'flex', flexDirection: 'column', gap: 8 }, children: [_jsx("div", { className: "text-xs text-muted", style: { wordBreak: 'break-all' }, children: user.email }), _jsx("button", { className: "btn btn-ghost btn-sm w-full", style: { justifyContent: 'flex-start' }, onClick: signOut, children: "Sign out" })] }))] }), _jsx("main", { className: "main-content", children: _jsx(Outlet, {}) })] }));
}
