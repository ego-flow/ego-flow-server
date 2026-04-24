export type UserRole = 'admin' | 'user'

export interface AuthUser {
  id: string
  role: UserRole
  displayName: string | null
}

export interface AuthSession {
  user: AuthUser
}
