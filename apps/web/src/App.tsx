import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { useEffect, useState } from 'react'
import { useAuth, AuthProvider } from './lib/auth'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AppLayout } from './components/AppLayout'
import { SignIn } from './pages/SignIn'
import { AuthCallback } from './pages/AuthCallback'
import { Onboarding } from './pages/Onboarding'
import { Today } from './pages/Today'
import { Matches } from './pages/Matches'
import { Applications } from './pages/Applications'
import { CVLab } from './pages/CVLab'
import { CVReview } from './pages/CVReview'
import { AgentSettings } from './pages/AgentSettings'
import { api } from './lib/api'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/sign-in" replace />
  return <>{children}</>
}

function OnboardingGate({ children }: { children: React.ReactNode }) {
  const [checked, setChecked] = useState(false)
  const [hasProfile, setHasProfile] = useState(false)

  useEffect(() => {
    api.getProfile()
      .then(profile => setHasProfile(!!profile))
      .catch(() => setHasProfile(false))
      .finally(() => setChecked(true))
  }, [])

  if (!checked) return null
  if (!hasProfile) return <Navigate to="/app/onboarding" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/today" replace />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/app/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
      <Route path="/app" element={<ProtectedRoute><OnboardingGate><AppLayout /></OnboardingGate></ProtectedRoute>}>
        <Route index element={<Navigate to="today" replace />} />
        <Route path="today"        element={<Today />} />
        <Route path="matches"      element={<Matches />} />
        <Route path="applications" element={<Applications />} />
        <Route path="cv-lab"       element={<CVLab />} />
        <Route path="cv-review"    element={<CVReview />} />
        <Route path="settings"     element={<AgentSettings />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </ErrorBoundary>
  )
}
