import { apiClient } from '#/api/client'
import type { AuthUser } from '#/lib/auth-session'

export interface LoginRequestInput {
  id: string
  password: string
  rememberMe: boolean
}

interface LoginResponse {
  token: string
  user: AuthUser
}

interface ChangeMyPasswordResponse {
  message: string
}

export async function requestLogin({
  id,
  password,
}: LoginRequestInput) {
  const response = await apiClient.post<LoginResponse>('/auth/login', {
    id,
    password,
  })

  return response.data
}

export async function requestLogout(): Promise<void> {
  return Promise.resolve()
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
