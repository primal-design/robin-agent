import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { useEffect, useState } from 'react';
import { useAuth, AuthProvider } from './lib/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppLayout } from './components/AppLayout';
import { SignIn } from './pages/SignIn';
import { AuthCallback } from './pages/AuthCallback';
import { Onboarding } from './pages/Onboarding';
import { Matches } from './pages/Matches';
import { Applications } from './pages/Applications';
import { CVLab } from './pages/CVLab';
import { CVReview } from './pages/CVReview';
import { AgentSettings } from './pages/AgentSettings';
import { api } from './lib/api';
function ProtectedRoute({ children }) {
    const { user, loading } = useAuth();
    if (loading)
        return null;
    if (!user)
        return _jsx(Navigate, { to: "/sign-in", replace: true });
    return _jsx(_Fragment, { children: children });
}
function OnboardingGate({ children }) {
    const [checked, setChecked] = useState(false);
    const [hasProfile, setHasProfile] = useState(false);
    useEffect(() => {
        api.getProfile()
            .then(profile => setHasProfile(!!profile))
            .catch(() => setHasProfile(false))
            .finally(() => setChecked(true));
    }, []);
    if (!checked)
        return null;
    if (!hasProfile)
        return _jsx(Navigate, { to: "/app/onboarding", replace: true });
    return _jsx(_Fragment, { children: children });
}
function AppRoutes() {
    return (_jsxs(Routes, { children: [_jsx(Route, { path: "/", element: _jsx(Navigate, { to: "/app/matches", replace: true }) }), _jsx(Route, { path: "/sign-in", element: _jsx(SignIn, {}) }), _jsx(Route, { path: "/auth/callback", element: _jsx(AuthCallback, {}) }), _jsx(Route, { path: "/app/onboarding", element: _jsx(ProtectedRoute, { children: _jsx(Onboarding, {}) }) }), _jsxs(Route, { path: "/app", element: _jsx(ProtectedRoute, { children: _jsx(OnboardingGate, { children: _jsx(AppLayout, {}) }) }), children: [_jsx(Route, { index: true, element: _jsx(Navigate, { to: "matches", replace: true }) }), _jsx(Route, { path: "today", element: _jsx(Navigate, { to: "/app/matches", replace: true }) }), _jsx(Route, { path: "matches", element: _jsx(Matches, {}) }), _jsx(Route, { path: "applications", element: _jsx(Applications, {}) }), _jsx(Route, { path: "cv-lab", element: _jsx(CVLab, {}) }), _jsx(Route, { path: "cv-review", element: _jsx(CVReview, {}) }), _jsx(Route, { path: "settings", element: _jsx(AgentSettings, {}) })] })] }));
}
export default function App() {
    return (_jsx(ErrorBoundary, { children: _jsx(AuthProvider, { children: _jsx(BrowserRouter, { children: _jsx(AppRoutes, {}) }) }) }));
}
