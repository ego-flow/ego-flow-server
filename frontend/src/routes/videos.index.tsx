import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { Filter, PlayCircle, RefreshCcw } from 'lucide-react'

import {
  formatDateTime,
  formatDuration,
  formatResolution,
  requestVideos,
  type SortOrder,
  type VideoSortBy,
  type VideoStatus,
} from '#/api/videos'
import { getApiErrorMessage, withAccessToken } from '#/api/client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useAuth } from '#/hooks/useAuth'
import { saveVideoSnapshot } from '#/lib/video-snapshots'

const PAGE_SIZE = 20
const VIDEO_STATUS_OPTIONS = ['ALL', 'PENDING', 'PROCESSING', 'COMPLETED', 'FAILED'] as const
const SORT_BY_OPTIONS = ['created_at', 'recorded_at', 'duration_sec'] as const
const SORT_ORDER_OPTIONS = ['desc', 'asc'] as const

type VideoStatusFilter = (typeof VIDEO_STATUS_OPTIONS)[number]

function isVideoStatusFilter(value: unknown): value is VideoStatusFilter {
  return typeof value === 'string' && VIDEO_STATUS_OPTIONS.includes(value as VideoStatusFilter)
}

function isVideoSortBy(value: unknown): value is VideoSortBy {
  return typeof value === 'string' && SORT_BY_OPTIONS.includes(value as VideoSortBy)
}

function isSortOrder(value: unknown): value is SortOrder {
  return typeof value === 'string' && SORT_ORDER_OPTIONS.includes(value as SortOrder)
}

function parsePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function statusClassName(status: VideoStatus) {
  switch (status) {
    case 'COMPLETED':
      return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
    case 'PROCESSING':
      return 'bg-amber-500/14 text-amber-700 dark:text-amber-300'
    case 'FAILED':
      return 'bg-red-500/12 text-red-700 dark:text-red-300'
    case 'PENDING':
    default:
      return 'bg-slate-500/12 text-slate-700 dark:text-slate-300'
  }
}

export const Route = createFileRoute('/videos/')({
  validateSearch: (search: Record<string, unknown>) => ({
    page: parsePositiveInteger(search.page, 1),
    videoKey: typeof search.videoKey === 'string' ? search.videoKey : '',
    status: isVideoStatusFilter(search.status) ? search.status : 'ALL',
    userId: typeof search.userId === 'string' ? search.userId : '',
    sortBy: isVideoSortBy(search.sortBy) ? search.sortBy : 'created_at',
    sortOrder: isSortOrder(search.sortOrder) ? search.sortOrder : 'desc',
  }),
  component: VideosPage,
})

function VideosPage() {
  const navigate = useNavigate({ from: '/videos/' })
  const { session } = useAuth()
  const search = Route.useSearch()
  const [filters, setFilters] = useState(search)

  useEffect(() => {
    setFilters(search)
  }, [search])

  const videosQuery = useQuery({
    queryKey: ['videos', search],
    queryFn: () =>
      requestVideos({
        page: search.page,
        limit: PAGE_SIZE,
        videoKey: search.videoKey,
        status: search.status,
        userId: session?.user.role === 'admin' ? search.userId : '',
        sortBy: search.sortBy,
        sortOrder: search.sortOrder,
      }),
  })

  const totalPages = Math.max(
    1,
    Math.ceil((videosQuery.data?.total ?? 0) / (videosQuery.data?.limit ?? PAGE_SIZE)),
  )

  const applyFilters = async () => {
    await navigate({
      to: '/videos',
      search: {
        page: 1,
        videoKey: filters.videoKey.trim(),
        status: filters.status,
        userId: session?.user.role === 'admin' ? filters.userId.trim() : '',
        sortBy: filters.sortBy,
        sortOrder: filters.sortOrder,
      },
    })
  }

  const resetFilters = async () => {
    await navigate({
      to: '/videos',
      search: {
        page: 1,
        videoKey: '',
        status: 'ALL',
        userId: '',
        sortBy: 'created_at',
        sortOrder: 'desc',
      },
    })
  }

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="island-kicker mb-2">Dashboard</p>
          <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
            Videos
          </h1>
          <p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
            Browse processed recordings, monitor status, and open playback details.
          </p>
        </div>
        <div className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-2 text-sm text-[var(--sea-ink-soft)]">
          {videosQuery.data?.total ?? 0} total videos
        </div>
      </header>

      <section className="island-shell rounded-2xl p-5 shadow-sm">
        <form
          className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            void applyFilters()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="video-key-filter">Video key</Label>
            <Input
              id="video-key-filter"
              value={filters.videoKey}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  videoKey: event.target.value,
                }))
              }
              placeholder="cooking_pasta"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status-filter">Status</Label>
            <select
              id="status-filter"
              value={filters.status}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  status: event.target.value as VideoStatusFilter,
                }))
              }
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {VIDEO_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sort-by-filter">Sort by</Label>
            <select
              id="sort-by-filter"
              value={filters.sortBy}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  sortBy: event.target.value as VideoSortBy,
                }))
              }
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="created_at">Created at</option>
              <option value="recorded_at">Recorded at</option>
              <option value="duration_sec">Duration</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sort-order-filter">Sort order</Label>
            <select
              id="sort-order-filter"
              value={filters.sortOrder}
              onChange={(event) =>
                setFilters((current) => ({
                  ...current,
                  sortOrder: event.target.value as SortOrder,
                }))
              }
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="desc">Newest first</option>
              <option value="asc">Oldest first</option>
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

          {session?.user.role === 'admin' ? (
            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="user-id-filter">User ID</Label>
              <Input
                id="user-id-filter"
                value={filters.userId}
                onChange={(event) =>
                  setFilters((current) => ({
                    ...current,
                    userId: event.target.value,
                  }))
                }
                placeholder="Filter by user"
              />
            </div>
          ) : null}
        </form>
      </section>

      {videosQuery.isPending ? (
        <section className="mt-6 rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center text-[var(--sea-ink-soft)]">
          Loading videos...
        </section>
      ) : videosQuery.isError ? (
        <section className="mt-6 rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
          {getApiErrorMessage(videosQuery.error, 'Failed to load videos.')}
        </section>
      ) : videosQuery.data && videosQuery.data.data.length > 0 ? (
        <>
          <section className="mt-6 grid gap-4 xl:grid-cols-2">
            {videosQuery.data.data.map((video) => (
              <Link
                key={video.id}
                to="/videos/$videoId"
                params={{ videoId: video.id }}
                onClick={() => {
                  saveVideoSnapshot(video)
                }}
                className="group rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] p-4 no-underline shadow-sm transition-transform hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--lagoon-deep)_38%,var(--line))]"
              >
                <div className="flex flex-col gap-4 sm:flex-row">
                  <div className="flex h-36 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_72%,var(--background))] sm:w-56">
                    {video.thumbnailUrl ? (
                      <img
                        src={withAccessToken(video.thumbnailUrl, session?.token) ?? undefined}
                        alt={video.videoKey}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <PlayCircle
                        size={36}
                        aria-hidden="true"
                        className="text-[var(--sea-ink-soft)]"
                      />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClassName(video.status)}`}
                      >
                        {video.status}
                      </span>
                      <span className="text-xs text-[var(--sea-ink-soft)]">
                        {video.userId}
                      </span>
                    </div>

                    <h2 className="mt-3 truncate text-xl font-semibold text-[var(--sea-ink)] transition-colors group-hover:text-[var(--lagoon-deep)]">
                      {video.videoKey}
                    </h2>

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
                      <div>
                        <dt className="font-semibold text-[var(--sea-ink)]">Created at</dt>
                        <dd>{formatDateTime(video.createdAt)}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </Link>
            ))}
          </section>

          <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Video pagination">
            <Button
              type="button"
              variant="outline"
              disabled={search.page <= 1}
              onClick={() => {
                void navigate({
                  to: '/videos',
                  search: {
                    ...search,
                    page: Math.max(1, search.page - 1),
                  },
                })
              }}
            >
              Prev
            </Button>
            <span className="min-w-24 text-center text-sm text-[var(--sea-ink-soft)]">
              Page {search.page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              disabled={search.page >= totalPages}
              onClick={() => {
                void navigate({
                  to: '/videos',
                  search: {
                    ...search,
                    page: Math.min(totalPages, search.page + 1),
                  },
                })
              }}
            >
              Next
            </Button>
          </nav>
        </>
      ) : (
        <section className="mt-6 rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center">
          <h2 className="text-lg font-semibold text-[var(--sea-ink)]">No videos found</h2>
          <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
            Adjust your filters or wait for processing to complete.
          </p>
        </section>
      )}
    </main>
  )
}
