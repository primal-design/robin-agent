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
    const displayName = user?.email?.split('@')[0] || 'FEN user';
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("nav", { className: "sidebar", children: [_jsxs("div", { className: "sidebar-logo", children: [_jsx("span", { className: "sidebar-logo-mark", children: "FEN" }), _jsx("div", { className: "sidebar-logo-title", children: "FEN" }), _jsx("div", { className: "sidebar-logo-subtitle", children: "A simpler way to manage job search momentum." })] }), _jsx("div", { className: "sidebar-section-label", children: "Workspace" }), navItems.map(({ to, label, Icon }) => (_jsxs(NavLink, { to: to, className: ({ isActive }) => `nav-item${isActive ? ' active' : ''}`, children: [_jsx(Icon, { size: 16, strokeWidth: 1.75 }), _jsx("span", { children: label })] }, to))), _jsx("div", { className: "sidebar-spacer" }), user && (_jsxs("div", { className: "sidebar-user", children: [_jsx("div", { className: "sidebar-user-label", children: "Signed In" }), _jsx("div", { className: "sidebar-user-name", children: displayName }), _jsx("div", { className: "sidebar-user-email", children: user.email }), _jsx("button", { className: "btn btn-ghost btn-sm w-full", onClick: signOut, children: "Sign out" })] }))] }), _jsxs("div", { className: "content-shell", children: [_jsx("div", { className: "mobile-nav", children: navItems.map(({ to, label, Icon }) => (_jsxs(NavLink, { to: to, className: ({ isActive }) => `mobile-nav-item${isActive ? ' active' : ''}`, children: [_jsx(Icon, { size: 15, strokeWidth: 1.9 }), _jsx("span", { children: label })] }, to))) }), _jsx("main", { className: "main-content", children: _jsx(Outlet, {}) })] })] }));
}
