import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'

import { useAuth } from '#/hooks/useAuth'

export const Route = createFileRoute('/repositories')({
  component: RepositoriesLayout,
})

function RepositoriesLayout() {
  const { isReady, isAuthenticated } = useAuth()

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  return <Outlet />
}
