import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  requestLogin,
  requestLogout,
  type LoginRequestInput,
} from '#/lib/auth'
import {
  clearStoredAuthSession,
  readStoredAuthSession,
  writeStoredAuthSession,
  type AuthSession,
} from '#/lib/auth-session'

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
    setSession(readStoredAuthSession())
    setIsReady(true)

    const syncAuthState = () => {
      setSession(readStoredAuthSession())
    }

    window.addEventListener('storage', syncAuthState)

    return () => {
      window.removeEventListener('storage', syncAuthState)
    }
  }, [])

  const login = async (input: LoginRequestInput) => {
    const response = await requestLogin(input)
    const persistence = input.rememberMe ? 'local' : 'session'
    const nextSession = {
      token: response.token,
      user: response.user,
      persistence,
    } satisfies AuthSession

    writeStoredAuthSession(
      {
        token: nextSession.token,
        user: nextSession.user,
      },
      persistence,
    )
    setSession(nextSession)
  }

  const logout = async () => {
    await requestLogout()
    clearStoredAuthSession()
    setSession(null)
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
