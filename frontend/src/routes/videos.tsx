import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'

import { useAuth } from '#/hooks/useAuth'

export const Route = createFileRoute('/videos')({
  component: VideosLayout,
})

function VideosLayout() {
  const { isReady, isAuthenticated } = useAuth()

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  return <Outlet />
}
