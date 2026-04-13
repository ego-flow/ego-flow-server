import { Navigate, createFileRoute } from '@tanstack/react-router'
import { defaultRepositoriesSearch } from '#/lib/route-search'

export const Route = createFileRoute('/videos/')({
  component: VideosIndexRedirect,
})

function VideosIndexRedirect() {
  return <Navigate to="/repositories" search={defaultRepositoriesSearch} />
}
