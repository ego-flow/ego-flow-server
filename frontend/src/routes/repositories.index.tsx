import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { FolderOpen, Plus, RefreshCcw, Search } from 'lucide-react'

import { getApiErrorMessage } from '#/api/client'
import { requestRepositories } from '#/api/repositories'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
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
  const [queryText, setQueryText] = useState(search.repositoryId)

  useEffect(() => {
    setQueryText(search.repositoryId)
  }, [search.repositoryId])

  const repositoriesQuery = useQuery({
    queryKey: ['repositories'],
    queryFn: requestRepositories,
  })

  const normalizedQuery = queryText.trim().toLowerCase()
  const visibleRepositories = (repositoriesQuery.data ?? []).filter((repository) => {
    if (!normalizedQuery) {
      return true
    }
    const haystack = `${repository.ownerId}/${repository.name}`.toLowerCase()
    return haystack.includes(normalizedQuery) || repository.id.toLowerCase().includes(normalizedQuery)
  })

  const applyFilter = async (next: string) => {
    await navigate({
      to: '/repositories',
      search: {
        repositoryId: next,
      },
    })
  }

  const resetFilter = async () => {
    setQueryText('')
    await applyFilter('')
  }

  return (
    <main className="page-wide px-6 py-8 sm:py-10">
      <section className="island-shell mb-6 rounded-2xl p-4 shadow-sm">
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-center"
          onSubmit={(event) => {
            event.preventDefault()
            void applyFilter(queryText.trim())
          }}
        >
          <div className="relative flex-1">
            <Search
              size={16}
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sea-ink-soft)]"
            />
            <Input
              id="repository-search"
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Search repositories by owner, name, or id"
              className="h-10 pl-9"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit">Search</Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void resetFilter()
              }}
            >
              <RefreshCcw size={16} aria-hidden="true" />
              Reset
            </Button>
          </div>
        </form>
      </section>

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

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {repositoriesQuery.isPending ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-8 text-center text-[var(--sea-ink-soft)] sm:col-span-2 lg:col-span-3 xl:col-span-4 2xl:col-span-5">
            Loading repositories...
          </div>
        ) : repositoriesQuery.isError ? (
          <div className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300 sm:col-span-2 lg:col-span-3 xl:col-span-4 2xl:col-span-5">
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
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center sm:col-span-2 lg:col-span-3 xl:col-span-4 2xl:col-span-5">
            <FolderOpen className="mx-auto text-[var(--sea-ink-soft)]" size={28} aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-[var(--sea-ink)]">
              {normalizedQuery ? 'No matching repositories' : 'No repositories yet'}
            </h2>
            <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
              {normalizedQuery
                ? 'Try a different search term or reset the filter.'
                : 'Create a repository before starting a new stream.'}
            </p>
          </div>
        )}
      </section>
    </main>
  )
}
