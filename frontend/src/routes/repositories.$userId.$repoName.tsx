import { createFileRoute } from '@tanstack/react-router'
import VideoCard from '#/components/VideoCard'

export const Route = createFileRoute('/repositories/$userId/$repoName')({
  component: RepositoryPage,
})

function RepositoryPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8">
      <VideoCard
        title="How Ego Flow Builds Smart Code Workflows"
        length="12:34"
        size="214 MB"
      />
    </div>
  )
}
