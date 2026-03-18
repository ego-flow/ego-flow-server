export interface LoginRequestInput {
  id: string
  password: string
  rememberMe: boolean
}

export interface AuthSession {
  userId: string
}

export async function requestLogin({
  id,
  password,
}: LoginRequestInput): Promise<AuthSession> {
  // Replace this mock with your server API call when auth endpoint is ready.
  // Example:
  // const response = await fetch('/api/auth/login', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify({ id, password }),
  // })
  // if (!response.ok) throw new Error('Login failed')
  // return (await response.json()) as AuthSession
  await new Promise((resolve) => setTimeout(resolve, 350))
  return { userId: id }
}

export async function requestLogout(): Promise<void> {
  // Replace this mock with your server API call when auth endpoint is ready.
  // Example:
  // const response = await fetch('/api/auth/logout', { method: 'POST' })
  // if (!response.ok) throw new Error('Logout failed')
  await new Promise((resolve) => setTimeout(resolve, 200))
}

