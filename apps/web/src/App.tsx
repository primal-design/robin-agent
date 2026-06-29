import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { useAuth, AuthProvider } from './lib/auth'
import { AppLayout } from './components/AppLayout'
import { SignIn } from './pages/SignIn'
import { AuthCallback } from './pages/AuthCallback'
import { Onboarding } from './pages/Onboarding'
import { Today } from './pages/Today'
import { Matches } from './pages/Matches'
import { Applications } from './pages/Applications'
import { CVLab } from './pages/CVLab'
import { AgentSettings } from './pages/AgentSettings'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/sign-in" replace />
  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/app/today" replace />} />
      <Route path="/sign-in" element={<SignIn />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/app/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
      <Route path="/app" element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
        <Route index element={<Navigate to="today" replace />} />
        <Route path="today"        element={<Today />} />
        <Route path="matches"      element={<Matches />} />
        <Route path="applications" element={<Applications />} />
        <Route path="cv-lab"       element={<CVLab />} />
        <Route path="settings"     element={<AgentSettings />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}
