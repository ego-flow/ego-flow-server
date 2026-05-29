import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, useNavigate, useRouterState } from '@tanstack/react-router'
import { ArrowLeft, Eye, EyeOff, PlayCircle, Settings, ShieldCheck, UserRound } from 'lucide-react'

import { getApiErrorMessage } from '#/api/client'
import { requestRepositoryDetail } from '#/api/repositories'
import {
  requestVideos,
  type SortOrder,
  type VideoSortBy,
  type VideoStatus,
} from '#/api/videos'
import { Button } from '#/components/ui/button'
import ProtectedImage from '#/components/ProtectedImage'
import { formatDateTime, formatDuration, formatResolution } from '#/lib/format'
import { defaultRepositoriesSearch, defaultRepositoryVideosSearch } from '#/lib/route-search'
import { saveVideoSnapshot } from '#/lib/video-snapshots'

function parsePositiveInteger(value: unknown, fallback: number, max?: number) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback
  }

  return typeof max === 'number' ? Math.min(parsed, max) : parsed
}

function parseVideoStatus(value: unknown): VideoStatus | 'ALL' {
  return value === 'PENDING' ||
    value === 'PROCESSING' ||
    value === 'COMPLETED' ||
    value === 'FAILED' ||
    value === 'ALL'
    ? value
    : 'ALL'
}

function parseSortBy(value: unknown): VideoSortBy {
  return value === 'recorded_at' || value === 'duration_sec'
    ? value
    : 'recorded_at'
}

function parseSortOrder(value: unknown): SortOrder {
  return value === 'asc' || value === 'desc' ? value : 'desc'
}

function getSortOptionValue(sortBy: VideoSortBy, sortOrder: SortOrder) {
  return `${sortBy}:${sortOrder}`
}

function parseSortOptionValue(value: string): { sortBy: VideoSortBy; sortOrder: SortOrder } {
  switch (value) {
    case 'recorded_at:asc':
      return { sortBy: 'recorded_at', sortOrder: 'asc' }
    case 'duration_sec:desc':
      return { sortBy: 'duration_sec', sortOrder: 'desc' }
    case 'duration_sec:asc':
      return { sortBy: 'duration_sec', sortOrder: 'asc' }
    case 'recorded_at:desc':
    default:
      return { sortBy: 'recorded_at', sortOrder: 'desc' }
  }
}

export const Route = createFileRoute('/repositories/$repoId')({
  validateSearch: (search: Record<string, unknown>) => ({
    page: parsePositiveInteger(search.page, defaultRepositoryVideosSearch.page),
    limit: parsePositiveInteger(search.limit, defaultRepositoryVideosSearch.limit, 100),
    status: parseVideoStatus(search.status),
    sortBy: parseSortBy(search.sortBy),
    sortOrder: parseSortOrder(search.sortOrder),
  }),
  component: RepositoryDetailPage,
})

function statusClassName(status: string) {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
    case 'PROCESSING':
      return 'bg-amber-500/14 text-amber-700 dark:text-amber-300'
    case 'FAILED':
      return 'bg-red-500/12 text-red-700 dark:text-red-300'
    default:
      return 'bg-slate-500/12 text-slate-700 dark:text-slate-300'
  }
}

function roleBadgeClassName(role: string) {
  switch (role) {
    case 'admin':
      return 'bg-indigo-500/14 text-indigo-700 dark:text-indigo-300'
    case 'maintain':
      return 'bg-amber-500/14 text-amber-700 dark:text-amber-300'
    case 'read':
      return 'bg-slate-500/12 text-slate-700 dark:text-slate-300'
    default:
      return 'bg-slate-500/12 text-slate-700 dark:text-slate-300'
  }
}

function MetaCard({
  icon,
  label,
  value,
}: {
  icon: ReactNode
  label: string
  value: ReactNode
}) {
  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3">
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sea-ink-soft)]">
        {icon}
        {label}
      </div>
      <div className="mt-1.5 truncate text-sm font-semibold text-[var(--sea-ink)]">{value}</div>
    </div>
  )
}

function RepositoryDetailPage() {
  const { repoId } = Route.useParams()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  if (pathname !== `/repositories/${repoId}`) {
    return <Outlet />
  }

  return <RepositoryOverview repoId={repoId} />
}

function RepositoryOverview({ repoId }: { repoId: string }) {
  const navigate = useNavigate({ from: '/repositories/$repoId' })
  const search = Route.useSearch()

  const repositoryQuery = useQuery({
    queryKey: ['repository', repoId],
    queryFn: () => requestRepositoryDetail(repoId),
  })

  const videosQuery = useQuery({
    queryKey: ['videos', 'repository', repoId, search],
    queryFn: () =>
      requestVideos(repoId, {
        page: search.page,
        limit: search.limit,
        status: search.status,
        sortBy: search.sortBy,
        sortOrder: search.sortOrder,
      }),
  })

  const repository = repositoryQuery.data
  const totalPages = Math.max(1, Math.ceil((videosQuery.data?.total ?? 0) / search.limit))

  const updateSearch = (nextSearch: Partial<typeof search>) =>
    navigate({
      to: '/repositories/$repoId',
      params: { repoId },
      search: {
        ...search,
        ...nextSearch,
      },
    })

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <div className="mb-5">
        <Link
          to="/repositories"
          search={defaultRepositoriesSearch}
          className="inline-flex items-center gap-2 text-sm font-semibold text-[var(--lagoon-deep)] no-underline hover:underline"
        >
          <span
            className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--chip-bg)] text-[var(--sea-ink)] transition-colors hover:bg-[var(--card)]"
            aria-hidden="true"
          >
            <ArrowLeft size={16} />
          </span>
          Back to repositories
        </Link>
      </div>

      {repositoryQuery.isError ? (
        <section className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
          {getApiErrorMessage(repositoryQuery.error, 'Failed to load repository.')}
        </section>
      ) : null}

      {repository ? (
        <>
          <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="island-kicker mb-2">Repository</p>
              <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
                {repository.name}
              </h1>
              <p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
                {repository.description || 'No description provided.'}
              </p>
            </div>

            {repository.myRole === 'admin' ? (
              <Link
                to="/repositories/$repoId/settings"
                params={{ repoId: repository.id }}
                search={search}
                className="no-underline"
              >
                <Button type="button" variant="outline">
                  <Settings size={16} aria-hidden="true" />
                  Repository settings
                </Button>
              </Link>
            ) : null}
          </header>

          <section className="mb-6 grid gap-3 sm:grid-cols-3">
            <MetaCard
              icon={<UserRound size={14} aria-hidden="true" />}
              label="Owner"
              value={repository.ownerId}
            />
            <MetaCard
              icon={repository.visibility === 'public' ? <Eye size={14} aria-hidden="true" /> : <EyeOff size={14} aria-hidden="true" />}
              label="Visibility"
              value={
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    repository.visibility === 'public'
                      ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                      : 'bg-slate-500/12 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {repository.visibility}
                </span>
              }
            />
            <MetaCard
              icon={<ShieldCheck size={14} aria-hidden="true" />}
              label="My role"
              value={
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleBadgeClassName(repository.myRole)}`}
                >
                  {repository.myRole}
                </span>
              }
            />
          </section>

          <section className="island-shell rounded-2xl p-5 shadow-sm">
            <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--sea-ink)]">Videos</h2>
                <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
                  Filter and sort recordings within this repository.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[26rem]">
                <label className="space-y-1 text-sm text-[var(--sea-ink-soft)]">
                  <span>Status</span>
                  <select
                    value={search.status}
                    onChange={(event) => {
                      void updateSearch({
                        status: parseVideoStatus(event.target.value),
                        page: 1,
                      })
                    }}
                    className="theme-select h-9 w-full rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="ALL">All</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="PROCESSING">Processing</option>
                    <option value="PENDING">Pending</option>
                    <option value="FAILED">Failed</option>
                  </select>
                </label>

                <label className="space-y-1 text-sm text-[var(--sea-ink-soft)]">
                  <span>Sort By</span>
                  <select
                    value={getSortOptionValue(search.sortBy, search.sortOrder)}
                    onChange={(event) => {
                      const sort = parseSortOptionValue(event.target.value)
                      void updateSearch({
                        ...sort,
                        page: 1,
                      })
                    }}
                    className="theme-select h-9 w-full rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <option value="recorded_at:desc">Newest first</option>
                    <option value="recorded_at:asc">Oldest first</option>
                    <option value="duration_sec:desc">Duration: longest first</option>
                    <option value="duration_sec:asc">Duration: shortest first</option>
                  </select>
                </label>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-1 text-xs text-[var(--sea-ink-soft)]">
                {videosQuery.data?.total ?? 0} total
              </span>
              <span className="text-sm text-[var(--sea-ink-soft)]">
                Page {search.page} of {totalPages}
              </span>
            </div>

            {videosQuery.isPending ? (
              <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center text-[var(--sea-ink-soft)]">
                Loading videos...
              </div>
            ) : videosQuery.isError ? (
              <div className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
                {getApiErrorMessage(videosQuery.error, 'Failed to load repository videos.')}
              </div>
            ) : videosQuery.data && videosQuery.data.data.length > 0 ? (
              <>
                <div className="grid gap-4">
                  {videosQuery.data.data.map((video) => (
                    <Link
                      key={video.id}
                      to="/repositories/$repoId/videos/$videoId"
                      params={{ repoId: repository.id, videoId: video.id }}
                      search={search}
                      onClick={() => {
                        saveVideoSnapshot(video)
                      }}
                      className="group rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] p-4 no-underline shadow-sm transition-transform hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--lagoon-deep)_38%,var(--line))]"
                    >
                      <div className="flex flex-col gap-4 sm:flex-row">
                        <div className="flex h-36 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_72%,var(--background))] sm:w-56">
                          {video.thumbnailUrl ? (
                            <ProtectedImage
                              src={video.thumbnailUrl}
                              alt={video.id}
                              className="h-full w-full object-cover"
                              fallback={
                                <PlayCircle
                                  size={36}
                                  aria-hidden="true"
                                  className="text-[var(--sea-ink-soft)]"
                                />
                              }
                            />
                          ) : (
                            <PlayCircle size={36} aria-hidden="true" className="text-[var(--sea-ink-soft)]" />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClassName(video.status)}`}
                            >
                              {video.status}
                            </span>
                          </div>

                          <h3 className="mt-3 truncate text-xl font-semibold text-[var(--sea-ink)] transition-colors group-hover:text-[var(--lagoon-deep)]">
                            {video.id}
                          </h3>

                          <dl className="mt-4 grid gap-2 text-sm text-[var(--sea-ink-soft)] sm:grid-cols-2">
                            <div>
                              <dt className="font-semibold text-[var(--sea-ink)]">Duration</dt>
                              <dd>{formatDuration(video.durationSec)}</dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-[var(--sea-ink)]">Resolution</dt>
                              <dd>{formatResolution(video)}</dd>
                            </div>
                            <div>
                              <dt className="font-semibold text-[var(--sea-ink)]">Recorded at</dt>
                              <dd>{formatDateTime(video.recordedAt)}</dd>
                            </div>
                          </dl>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>

                <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={search.page <= 1}
                    onClick={() => {
                      void updateSearch({ page: Math.max(1, search.page - 1) })
                    }}
                  >
                    Previous page
                  </Button>
                  <span className="text-sm text-[var(--sea-ink-soft)]">
                    Showing page {search.page} of {totalPages}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={search.page >= totalPages}
                    onClick={() => {
                      void updateSearch({ page: Math.min(totalPages, search.page + 1) })
                    }}
                  >
                    Next page
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center">
                <h3 className="text-lg font-semibold text-[var(--sea-ink)]">No videos found</h3>
                <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
                  Adjust the filters or start an RTMP publish session into this repository.
                </p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  )
}
