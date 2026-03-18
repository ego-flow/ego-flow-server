import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  requestLogin,
  requestLogout,
  type AuthSession,
  type LoginRequestInput,
} from '#/lib/auth'

const AUTH_STORAGE_KEY = 'ego-flow-auth-session'

interface AuthContextValue {
  isReady: boolean
  isAuthenticated: boolean
  session: AuthSession | null
  login: (input: LoginRequestInput) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isReady, setIsReady] = useState(false)
  const [session, setSession] = useState<AuthSession | null>(null)

  useEffect(() => {
    try {
      const rawSession = window.localStorage.getItem(AUTH_STORAGE_KEY)
      if (rawSession) {
        const parsed = JSON.parse(rawSession) as AuthSession
        if (parsed?.userId) {
          setSession(parsed)
        }
      }
    } catch {
      // no-op
    } finally {
      setIsReady(true)
    }
  }, [])

  const login = async (input: LoginRequestInput) => {
    const nextSession = await requestLogin(input)
    setSession(nextSession)

    if (input.rememberMe) {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextSession))
      return
    }

    window.localStorage.removeItem(AUTH_STORAGE_KEY)
  }

  const logout = async () => {
    await requestLogout()
    setSession(null)
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      isReady,
      isAuthenticated: Boolean(session),
      session,
      login,
      logout,
    }),
    [isReady, session],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const auth = useContext(AuthContext)

  if (!auth) {
    throw new Error('useAuth must be used within AuthProvider')
  }

  return auth
}

