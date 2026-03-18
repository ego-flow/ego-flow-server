import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useAuth } from '#/hooks/useAuth'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const { isReady, isAuthenticated } = useAuth()

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  return <main />
}
