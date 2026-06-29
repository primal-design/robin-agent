import React, { createContext, useContext, useEffect, useState } from 'react'
import type { AuthUser } from './types'

interface AuthCtx {
  user: AuthUser | null
  loading: boolean
  signIn: (email: string) => Promise<void>
  signOut: () => void
  setTokenFromCallback: (token: string) => Promise<void>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const raw = localStorage.getItem('fen_auth')
    if (raw) {
      try { setUser(JSON.parse(raw)) } catch { localStorage.removeItem('fen_auth') }
    }
    setLoading(false)
  }, [])

  const signIn = async (email: string) => {
    const { api } = await import('./api')
    await api.sendMagicLink(email)
  }

  const setTokenFromCallback = async (token: string) => {
    const { api } = await import('./api')
    const data = await api.verifyToken(token)
    const authUser: AuthUser = { email: data.email, tenantId: data.tenantId, token: data.token }
    localStorage.setItem('fen_token', data.token)
    localStorage.setItem('fen_auth', JSON.stringify(authUser))
    setUser(authUser)
  }

  const signOut = () => {
    localStorage.removeItem('fen_token')
    localStorage.removeItem('fen_auth')
    setUser(null)
  }

  return <Ctx.Provider value={{ user, loading, signIn, signOut, setTokenFromCallback }}>{children}</Ctx.Provider>
}

export function useAuth() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
