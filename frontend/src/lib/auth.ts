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
