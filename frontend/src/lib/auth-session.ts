export type UserRole = 'admin' | 'user'
export type AuthPersistence = 'local' | 'session'

export interface AuthUser {
  id: string
  role: UserRole
  displayName: string | null
}

export interface AuthSession {
  token: string
  user: AuthUser
  persistence: AuthPersistence
}

const LOCAL_AUTH_STORAGE_KEY = 'ego-flow-auth-session'
const SESSION_AUTH_STORAGE_KEY = 'ego-flow-auth-session:session'

function getStorage(persistence: AuthPersistence) {
  if (typeof window === 'undefined') {
    return null
  }

  return persistence === 'local' ? window.localStorage : window.sessionStorage
}

function getStorageKey(persistence: AuthPersistence) {
  return persistence === 'local' ? LOCAL_AUTH_STORAGE_KEY : SESSION_AUTH_STORAGE_KEY
}

function normalizeSession(rawValue: string | null, persistence: AuthPersistence) {
  if (!rawValue) {
    return null
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<AuthSession>

    if (
      typeof parsed.token !== 'string' ||
      !parsed.user ||
      typeof parsed.user.id !== 'string' ||
      (parsed.user.role !== 'admin' && parsed.user.role !== 'user')
    ) {
      return null
    }

    return {
      token: parsed.token,
      user: {
        id: parsed.user.id,
        role: parsed.user.role,
        displayName:
          typeof parsed.user.displayName === 'string' ? parsed.user.displayName : null,
      },
      persistence,
    } satisfies AuthSession
  } catch {
    return null
  }
}

export function readStoredAuthSession() {
  const localStorage = getStorage('local')
  const sessionStorage = getStorage('session')

  if (!localStorage || !sessionStorage) {
    return null
  }

  return (
    normalizeSession(localStorage.getItem(LOCAL_AUTH_STORAGE_KEY), 'local') ??
    normalizeSession(sessionStorage.getItem(SESSION_AUTH_STORAGE_KEY), 'session')
  )
}

export function writeStoredAuthSession(
  session: Omit<AuthSession, 'persistence'>,
  persistence: AuthPersistence,
) {
  const targetStorage = getStorage(persistence)
  const otherPersistence = persistence === 'local' ? 'session' : 'local'
  const otherStorage = getStorage(otherPersistence)

  if (!targetStorage || !otherStorage) {
    return
  }

  otherStorage.removeItem(getStorageKey(otherPersistence))
  targetStorage.setItem(getStorageKey(persistence), JSON.stringify(session))
}

export function replaceStoredAuthToken(token: string) {
  const currentSession = readStoredAuthSession()
  if (!currentSession) {
    return
  }

  writeStoredAuthSession(
    {
      token,
      user: currentSession.user,
    },
    currentSession.persistence,
  )
}

export function clearStoredAuthSession() {
  getStorage('local')?.removeItem(LOCAL_AUTH_STORAGE_KEY)
  getStorage('session')?.removeItem(SESSION_AUTH_STORAGE_KEY)
}
