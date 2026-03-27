import { Navigate, createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/videos')({
  component: VideosRedirect,
})

function VideosRedirect() {
  return <Navigate to="/repositories" />
}
