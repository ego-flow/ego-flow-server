import { apiClient } from '#/api/client'
import type { AuthUser } from '#/lib/auth-session'

export interface LoginRequestInput {
  id: string
  password: string
  rememberMe: boolean
}

interface LoginResponse {
  user: AuthUser
}

interface ChangeMyPasswordResponse {
  message: string
}

export async function requestLogin({
  id,
  password,
  rememberMe,
}: LoginRequestInput) {
  const response = await apiClient.post<LoginResponse>('/auth/dashboard/login', {
    id,
    password,
    remember_me: rememberMe,
  })

  return response.data
}

export async function requestLogout(): Promise<void> {
  await apiClient.post('/auth/dashboard/logout')
}

export async function requestCurrentSession() {
  const response = await apiClient.get<LoginResponse>('/auth/dashboard/session')
  return response.data
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
