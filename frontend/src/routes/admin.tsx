import { Navigate, Outlet, createFileRoute } from '@tanstack/react-router'

import { useAuth } from '#/hooks/useAuth'
import { defaultRepositoriesSearch } from '#/lib/route-search'

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
    return <Navigate to="/repositories" search={defaultRepositoriesSearch} />
  }

  return <Outlet />
}
