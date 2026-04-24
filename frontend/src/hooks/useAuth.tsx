import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import {
  requestCurrentSession,
  requestLogin,
  requestLogout,
  type LoginRequestInput,
} from '#/lib/auth'
import type { AuthSession } from '#/lib/auth-session'

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
    let isCancelled = false

    requestCurrentSession()
      .then((response) => {
        if (!isCancelled) {
          setSession({ user: response.user })
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setSession(null)
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsReady(true)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [])

  const login = async (input: LoginRequestInput) => {
    const response = await requestLogin(input)
    const nextSession = {
      user: response.user,
    } satisfies AuthSession

    setSession(nextSession)
  }

  const logout = async () => {
    await requestLogout()
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
