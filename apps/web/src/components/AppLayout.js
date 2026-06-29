import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../lib/auth';
const navItems = [
    { to: '/app/today', label: 'Today', icon: '◎' },
    { to: '/app/matches', label: 'Matches', icon: '✦' },
    { to: '/app/applications', label: 'Applications', icon: '📋' },
    { to: '/app/cv-lab', label: 'CV Lab', icon: '📄' },
    { to: '/app/settings', label: 'Settings', icon: '⚙' },
];
export function AppLayout() {
    const { signOut, user } = useAuth();
    return (_jsxs("div", { className: "app-shell", children: [_jsxs("nav", { className: "sidebar", children: [_jsx("div", { className: "sidebar-logo", children: _jsx("span", { children: "FEN" }) }), navItems.map(n => (_jsxs(NavLink, { to: n.to, className: ({ isActive }) => `nav-item${isActive ? ' active' : ''}`, children: [_jsx("span", { children: n.icon }), _jsx("span", { children: n.label })] }, n.to))), _jsx("div", { className: "sidebar-spacer" }), user && (_jsxs("div", { style: { padding: '0 8px' }, children: [_jsx("div", { className: "text-sm text-muted", style: { marginBottom: 8, wordBreak: 'break-all' }, children: user.email }), _jsx("button", { className: "btn btn-outline btn-sm w-full", onClick: signOut, children: "Sign out" })] }))] }), _jsx("main", { className: "main-content", children: _jsx(Outlet, {}) })] }));
}
