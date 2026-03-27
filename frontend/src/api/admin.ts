import { apiClient } from '#/api/client'
import type { UserRole } from '#/lib/auth-session'

export interface AdminUser {
  id: string
  role: UserRole
  displayName: string | null
  createdAt: string
  isActive: boolean
}

export interface AdminSettings {
  targetDirectory: string | null
}

export async function requestAdminUsers() {
  const response = await apiClient.get<{
    users: Array<{
      id: string
      role: UserRole
      displayName: string | null
      createdAt: string
      is_active: boolean
    }>
  }>('/admin/users')

  return response.data.users.map((user) => ({
    id: user.id,
    role: user.role,
    displayName: user.displayName,
    createdAt: user.createdAt,
    isActive: user.is_active,
  })) satisfies AdminUser[]
}

export async function requestCreateUser(input: {
  id: string
  password: string
  displayName: string
}) {
  const response = await apiClient.post('/admin/users', {
    id: input.id,
    password: input.password,
    displayName: input.displayName || undefined,
  })

  return response.data
}

export async function requestResetUserPassword(userId: string, newPassword: string) {
  const response = await apiClient.put(
    `/admin/users/${encodeURIComponent(userId)}/reset-password`,
    {
      newPassword,
    },
  )

  return response.data
}

export async function requestDeleteUser(userId: string) {
  const response = await apiClient.delete(`/admin/users/${encodeURIComponent(userId)}`)
  return response.data
}

export async function requestAdminSettings() {
  const response = await apiClient.get<{
    settings: {
      target_directory: string | null
    }
  }>('/admin/settings')

  return {
    targetDirectory: response.data.settings.target_directory,
  } satisfies AdminSettings
}
