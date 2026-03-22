import { Navigate, createFileRoute } from '@tanstack/react-router'
import { useAuth } from '#/hooks/useAuth'

export const Route = createFileRoute('/')({
  component: HomeRedirect,
})

function HomeRedirect() {
  const { isReady, isAuthenticated } = useAuth()

  if (!isReady) {
    return null
  }

  return <Navigate to={isAuthenticated ? '/videos' : '/login'} />
}
