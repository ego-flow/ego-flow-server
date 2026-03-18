import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/repositories/$userId/$repoName')({
  component: RepositoryPage,
})

function RepositoryPage() {
  return <div>this is repository page</div>
}
