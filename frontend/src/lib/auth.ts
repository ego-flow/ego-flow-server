import { apiClient } from '#/api/client'
import type { AuthUser } from '#/lib/auth-session'

export interface LoginRequestInput {
  id: string
  password: string
  rememberMe: boolean
}

interface AuthUserApiRecord {
  id?: unknown
  role?: unknown
  displayName?: unknown
  display_name?: unknown
}

interface AuthResponseApiRecord {
  user?: AuthUserApiRecord | null
}

interface ChangeMyPasswordResponse {
  message: string
}

export async function requestLogin({
  id,
  password,
  rememberMe,
}: LoginRequestInput) {
  const response = await apiClient.post<AuthResponseApiRecord>('/auth/dashboard/login', {
    id,
    password,
    remember_me: rememberMe,
  })

  return normalizeAuthResponse(response.data)
}

export async function requestLogout(): Promise<void> {
  await apiClient.post('/auth/dashboard/logout')
}

export async function requestCurrentSession() {
  const response = await apiClient.get<AuthResponseApiRecord>('/auth/dashboard/session')
  return normalizeAuthResponse(response.data)
}

export async function requestChangeMyPassword(input: {
  currentPassword: string
  newPassword: string
}) {
  const response = await apiClient.put<ChangeMyPasswordResponse>(
    '/users/me/password',
    input,
  )

  return response.data
}

function normalizeAuthResponse(response: AuthResponseApiRecord) {
  const user = normalizeAuthUser(response.user)

  if (!user) {
    throw new Error('Invalid authentication response.')
  }

  return { user }
}

function normalizeAuthUser(user: AuthUserApiRecord | null | undefined): AuthUser | null {
  if (!user || typeof user.id !== 'string') {
    return null
  }

  if (user.role !== 'admin' && user.role !== 'user') {
    return null
  }

  const displayName = user.displayName ?? user.display_name

  return {
    id: user.id,
    role: user.role,
    displayName: typeof displayName === 'string' ? displayName : null,
  }
}
