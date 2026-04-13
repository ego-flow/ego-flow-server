import { Navigate, createFileRoute } from '@tanstack/react-router'

import { useAuth } from '#/hooks/useAuth'
import { defaultRepositoriesSearch } from '#/lib/route-search'

export const Route = createFileRoute('/videos/$videoId')({
  component: LegacyVideoRedirect,
})

function LegacyVideoRedirect() {
  const { isReady, isAuthenticated } = useAuth()

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  return <Navigate to="/repositories" search={defaultRepositoriesSearch} />
}
