import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Database, Eye, EyeOff, FolderOpen, Plus, RefreshCcw, Search, ShieldCheck } from 'lucide-react'

import { getApiErrorMessage } from '#/api/client'
import { type RepositoryRecord, type RepositoryRole, requestRepositories } from '#/api/repositories'
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

function roleBadgeClassName(role: RepositoryRole) {
  switch (role) {
    case 'admin':
      return 'bg-indigo-500/14 text-indigo-700 dark:text-indigo-300'
    case 'maintain':
      return 'bg-amber-500/14 text-amber-700 dark:text-amber-300'
    case 'read':
      return 'bg-slate-500/12 text-slate-700 dark:text-slate-300'
  }
}

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
    return repository.name.toLowerCase().includes(normalizedQuery)
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
    <main className="page-full px-6 py-8 sm:py-10">
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
              placeholder="Search repositories by name"
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

      <section className="flex flex-col gap-3">
        {repositoriesQuery.isPending ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-8 text-center text-[var(--sea-ink-soft)]">
            Loading repositories...
          </div>
        ) : repositoriesQuery.isError ? (
          <div className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
            {getApiErrorMessage(repositoriesQuery.error, 'Failed to load repositories.')}
          </div>
        ) : visibleRepositories.length > 0 ? (
          visibleRepositories.map((repository) => (
            <RepositoryRow key={repository.id} repository={repository} />
          ))
        ) : (
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center">
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

function RepositoryRow({ repository }: { repository: RepositoryRecord }) {
  const isPublic = repository.visibility === 'public'
  const datasetCount = repository.videoCount ?? 0

  return (
    <Link
      to="/repositories/$repoId"
      params={{ repoId: repository.id }}
      search={defaultRepositoryVideosSearch}
      className="island-shell block w-full rounded-2xl p-5 no-underline shadow-sm transition-transform hover:-translate-y-0.5"
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-xl font-bold text-[var(--sea-ink)]">{repository.name}</h2>
          <p className="mt-2 line-clamp-2 text-sm text-[var(--sea-ink-soft)]">
            {repository.description || 'No description provided.'}
          </p>
        </div>

        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
          <Chip
            icon={isPublic ? <Eye size={12} aria-hidden="true" /> : <EyeOff size={12} aria-hidden="true" />}
            label="Visibility"
            value={repository.visibility}
            tone={isPublic ? 'emerald' : 'slate'}
          />
          <Chip
            icon={<ShieldCheck size={12} aria-hidden="true" />}
            label="My role"
            value={repository.myRole}
            valueClassName={roleBadgeClassName(repository.myRole)}
          />
          <Chip
            icon={<Database size={12} aria-hidden="true" />}
            label="Datasets"
            value={datasetCount.toLocaleString()}
            tone="lagoon"
          />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--line)] pt-3 text-xs text-[var(--sea-ink-soft)]">
        <span>
          Created <span className="text-[var(--sea-ink)]">{formatDateTime(repository.createdAt)}</span>
        </span>
        <span aria-hidden="true">·</span>
        <span>
          Updated <span className="text-[var(--sea-ink)]">{formatDateTime(repository.updatedAt)}</span>
        </span>
      </div>
    </Link>
  )
}

function Chip({
  icon,
  label,
  value,
  tone,
  valueClassName,
}: {
  icon: ReactNode
  label: string
  value: string
  tone?: 'emerald' | 'slate' | 'lagoon'
  valueClassName?: string
}) {
  const defaultToneClass =
    tone === 'emerald'
      ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
      : tone === 'lagoon'
        ? 'bg-sky-500/14 text-sky-700 dark:text-sky-300'
        : tone === 'slate'
          ? 'bg-slate-500/12 text-slate-700 dark:text-slate-300'
          : 'bg-[var(--chip-bg)] text-[var(--sea-ink)]'

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--chip-bg)] py-1 pl-2 pr-2.5 text-xs">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sea-ink-soft)]">
        {icon}
        {label}
      </span>
      <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${valueClassName ?? defaultToneClass}`}>
        {value}
      </span>
    </div>
  )
}
