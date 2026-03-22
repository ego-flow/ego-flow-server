import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'

import { useAuth } from '#/hooks/useAuth'

export const Route = createFileRoute('/admin')({
  component: AdminLayout,
})

function AdminLayout() {
  const { isReady, isAuthenticated, session } = useAuth()

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  if (session?.user.role !== 'admin') {
    return <Navigate to="/videos" />
  }

  return <Outlet />
}
