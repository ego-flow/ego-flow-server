import { useQuery } from '@tanstack/react-query'
import { Navigate, createFileRoute } from '@tanstack/react-router'

import { requestVideoDetail } from '#/api/videos'
import { useAuth } from '#/hooks/useAuth'

export const Route = createFileRoute('/videos/$videoId')({
  component: LegacyVideoRedirect,
})

function LegacyVideoRedirect() {
  const { videoId } = Route.useParams()
  const { isReady, isAuthenticated, session } = useAuth()

  const detailQuery = useQuery({
    queryKey: ['legacy-video-redirect', videoId],
    queryFn: () => requestVideoDetail(videoId),
    enabled: isReady && isAuthenticated,
  })

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  if (detailQuery.isPending) {
    return null
  }

  if (!detailQuery.data) {
    return <Navigate to="/repositories" />
  }

  return (
    <Navigate
      to="/repositories/$repoId/videos/$videoId"
      params={{
        repoId: detailQuery.data.repositoryId,
        videoId,
      }}
    />
  )
}
