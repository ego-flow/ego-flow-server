import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Filter, FolderOpen, Plus, RefreshCcw } from 'lucide-react'

import { getApiErrorMessage } from '#/api/client'
import { requestRepositories } from '#/api/repositories'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { formatDateTime } from '#/lib/format'
import { defaultRepositoryVideosSearch } from '#/lib/route-search'

export const Route = createFileRoute('/repositories/')({
  validateSearch: (search: Record<string, unknown>) => ({
    repositoryId: typeof search.repositoryId === 'string' ? search.repositoryId : '',
  }),
  component: RepositoriesPage,
})

function RepositoriesPage() {
  const navigate = useNavigate({ from: '/repositories/' })
  const search = Route.useSearch()
  const [filters, setFilters] = useState(search)

  useEffect(() => {
    setFilters(search)
  }, [search])

  const repositoriesQuery = useQuery({
    queryKey: ['repositories'],
    queryFn: requestRepositories,
  })

  const visibleRepositories = (repositoriesQuery.data ?? []).filter((repository) =>
    !search.repositoryId || repository.id === search.repositoryId,
  )

  const applyFilters = async () => {
    await navigate({
      to: '/repositories',
      search: {
        repositoryId: filters.repositoryId,
      },
    })
  }

  const resetFilters = async () => {
    await navigate({
      to: '/repositories',
      search: {
        repositoryId: '',
      },
    })
  }

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="island-kicker mb-2">Dashboard</p>
          <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
            Repositories
          </h1>
          <p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
            Browse accessible repositories and inspect processed recordings by repository.
          </p>
        </div>
        <Link to="/repositories/new" className="no-underline">
          <Button type="button">
            <Plus size={16} aria-hidden="true" />
            New repository
          </Button>
        </Link>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        {repositoriesQuery.isPending ? (
          <div className="lg:col-span-3 rounded-2xl border border-dashed border-[var(--line)] px-6 py-8 text-center text-[var(--sea-ink-soft)]">
            Loading repositories...
          </div>
        ) : repositoriesQuery.isError ? (
          <div className="lg:col-span-3 rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
            {getApiErrorMessage(repositoriesQuery.error, 'Failed to load repositories.')}
          </div>
        ) : visibleRepositories.length > 0 ? (
          visibleRepositories.map((repository) => (
            <Link
              key={repository.id}
              to="/repositories/$repoId"
              params={{ repoId: repository.id }}
              search={defaultRepositoryVideosSearch}
              className="island-shell rounded-2xl p-5 no-underline shadow-sm transition-transform hover:-translate-y-0.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-semibold text-[var(--sea-ink)]">
                    {repository.name}
                  </h2>
                  <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">{repository.ownerId}</p>
                </div>
                <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                  {repository.myRole}
                </span>
              </div>
              <p className="mt-4 line-clamp-2 text-sm text-[var(--sea-ink-soft)]">
                {repository.description || 'No description provided.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--sea-ink-soft)]">
                <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1">
                  {repository.visibility}
                </span>
                <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1">
                  Updated {formatDateTime(repository.updatedAt)}
                </span>
              </div>
            </Link>
          ))
        ) : (
          <div className="lg:col-span-3 rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center">
            <FolderOpen className="mx-auto text-[var(--sea-ink-soft)]" size={28} aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-[var(--sea-ink)]">No repositories yet</h2>
            <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
              Create a repository before starting a new stream.
            </p>
          </div>
        )}
      </section>

      <section className="island-shell mt-6 rounded-2xl p-5 shadow-sm">
        <form
          className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            void applyFilters()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="repository-filter">Repository</Label>
            <select
              id="repository-filter"
              value={filters.repositoryId}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  repositoryId: event.target.value,
                }))
              }
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="">All accessible repositories</option>
              {(repositoriesQuery.data ?? []).map((repository) => (
                <option key={repository.id} value={repository.id}>
                  {repository.ownerId}/{repository.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <Button type="submit" className="w-full sm:w-auto">
              <Filter size={16} aria-hidden="true" />
              Apply
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void resetFilters()
              }}
            >
              <RefreshCcw size={16} aria-hidden="true" />
              Reset
            </Button>
          </div>
        </form>
      </section>
    </main>
  )
}
