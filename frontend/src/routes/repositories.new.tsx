import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'

import { getApiErrorMessage } from '#/api/client'
import { requestCreateRepository, type RepositoryVisibility } from '#/api/repositories'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

export const Route = createFileRoute('/repositories/new')({
  component: NewRepositoryPage,
})

function NewRepositoryPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [visibility, setVisibility] = useState<RepositoryVisibility>('private')
  const [description, setDescription] = useState('')

  const createMutation = useMutation({
    mutationFn: () =>
      requestCreateRepository({
        name,
        visibility,
        description,
      }),
    onSuccess: async (repository) => {
      await queryClient.invalidateQueries({ queryKey: ['repositories'] })
      await navigate({ to: '/repositories/$repoId', params: { repoId: repository.id } })
    },
  })

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <div className="mb-5">
        <Link
          to="/repositories"
          className="text-sm font-semibold text-[var(--lagoon-deep)] no-underline hover:underline"
        >
          Back to repositories
        </Link>
      </div>

      <section className="island-shell mx-auto max-w-3xl rounded-2xl p-6 shadow-sm">
        <p className="island-kicker mb-2">Repositories</p>
        <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          Create repository
        </h1>
        <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
          Streams, recordings, and permissions are now organized per repository.
        </p>

        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            createMutation.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="repository-name">Repository name</Label>
            <Input
              id="repository-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="daily_kitchen"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="repository-visibility">Visibility</Label>
            <select
              id="repository-visibility"
              value={visibility}
              onChange={(event) => setVisibility(event.target.value as RepositoryVisibility)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="private">private</option>
              <option value="public">public</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="repository-description">Description</Label>
            <textarea
              id="repository-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={4}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="Short description of what this repository is for."
            />
          </div>

          {createMutation.isError ? (
            <p className="text-sm text-red-700 dark:text-red-300">
              {getApiErrorMessage(createMutation.error, 'Failed to create repository.')}
            </p>
          ) : null}

          <Button type="submit" disabled={createMutation.isPending || !name.trim()}>
            Create repository
          </Button>
        </form>
      </section>
    </main>
  )
}
