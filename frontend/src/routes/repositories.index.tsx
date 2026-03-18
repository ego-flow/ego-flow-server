import { createFileRoute } from '@tanstack/react-router'
import RepositoryCard from '#/components/RepositoryCard'

export const Route = createFileRoute('/repositories/')({
  component: RepositoriesPage,
})

function RepositoriesPage() {
  return (
    <main className="page-wrap px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="mb-4 text-xl font-bold text-[var(--sea-ink)]">Repositories</h1>
        <div className="space-y-3">
          <RepositoryCard
            userId="markov-ai"
            repoName="computer-use-large"
            updatedText="Updated 2 days ago"
            size="5.3GB"
            length="3.8 hours"
          />
          <RepositoryCard
            userId="devpotatopotato"
            repoName="test-temp-video"
            updatedText="Updated 10 days ago"
            size="10MB"
            length="30 minutes"
          />
          <RepositoryCard
            userId="devpotatopotato"
            repoName="test-temp-video"
            updatedText="Updated 10 days ago"
            size="10MB"
            length="30 minutes"
          />
          <RepositoryCard
            userId="devpotatopotato"
            repoName="test-temp-video"
            updatedText="Updated 10 days ago"
            size="10MB"
            length="30 minutes"
          />
          <RepositoryCard
            userId="devpotatopotato"
            repoName="test-temp-video"
            updatedText="Updated 10 days ago"
            size="10MB"
            length="30 minutes"
          />
          <RepositoryCard
            userId="devpotatopotato"
            repoName="test-temp-video"
            updatedText="Updated 10 days ago"
            size="10MB"
            length="30 minutes"
          />
          <RepositoryCard
            userId="devpotatopotato"
            repoName="test-temp-video"
            updatedText="Updated 10 days ago"
            size="10MB"
            length="30 minutes"
          />
        </div>
      </div>
    </main>
  )
}
