import { createFileRoute } from '@tanstack/react-router'
export const Route = createFileRoute('/videos/')({
  component: VideosIndexRedirect,
})

function VideosIndexRedirect() {
  return <Navigate to="/repositories" />
}
