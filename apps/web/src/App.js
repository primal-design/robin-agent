import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { useAuth, AuthProvider } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppLayout } from './components/AppLayout';
import { SignIn } from './pages/SignIn';
import { AuthCallback } from './pages/AuthCallback';
import { Onboarding } from './pages/Onboarding';
import { Today } from './pages/Today';
import { Matches } from './pages/Matches';
import { Applications } from './pages/Applications';
import { CVLab } from './pages/CVLab';
import { AgentSettings } from './pages/AgentSettings';
function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    if (loading)
        return null;
    if (!user)
        return _jsx(Navigate, { to: "/sign-in", replace: true });
    return _jsx(_Fragment, { children: children });
}
function AppRoutes() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: "/app/today", replace: true }) }), _jsx(Route, { path: "/sign-in", element: _jsx(SignIn, {}) }), _jsx(Route, { path: "/auth/callback", element: _jsx(AuthCallback, {}) }), _jsx(Route, { path: "/app/onboarding", element: _jsx(ProtectedRoute, { children: _jsx(Onboarding, {}) }) }), _jsxs(Route, { path: "/app", element: _jsx(ProtectedRoute, { children: _jsx(AppLayout, {}) }), children: [_jsx(Route, { index: true, element: _jsx(Navigate, { to: "today", replace: true }) }), _jsx(Route, { path: "today", element: _jsx(Today, {}) }), _jsx(Route, { path: "matches", element: _jsx(Matches, {}) }), _jsx(Route, { path: "applications", element: _jsx(Applications, {}) }), _jsx(Route, { path: "cv-lab", element: _jsx(CVLab, {}) }), _jsx(Route, { path: "settings", element: _jsx(AgentSettings, {}) })] })] }));
}
export default function App() {
    return (_jsx(ErrorBoundary, { children: _jsx(AuthProvider, { children: _jsx(BrowserRouter, { children: _jsx(AppRoutes, {}) }) }) }));
}
