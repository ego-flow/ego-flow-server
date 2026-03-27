import { useQuery } from '@tanstack/react-query'
import { Link, Outlet, createFileRoute, useRouterState } from '@tanstack/react-router'
import { PlayCircle, Settings } from 'lucide-react'

import { getApiErrorMessage, withAccessToken } from '#/api/client'
import { requestRepositoryDetail } from '#/api/repositories'
import { formatDateTime, formatDuration, formatResolution, requestVideos } from '#/api/videos'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/hooks/useAuth'
import { saveVideoSnapshot } from '#/lib/video-snapshots'

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

export const Route = createFileRoute('/repositories/$repoId')({
  component: RepositoryDetailPage,
})

function RepositoryDetailPage() {
  const { repoId } = Route.useParams()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  if (pathname !== `/repositories/${repoId}`) {
    return <Outlet />
  }

  return <RepositoryOverview repoId={repoId} />
}

function RepositoryOverview({ repoId }: { repoId: string }) {
  const { session } = useAuth()

  const repositoryQuery = useQuery({
    queryKey: ['repository', repoId],
    queryFn: () => requestRepositoryDetail(repoId),
  })

  const videosQuery = useQuery({
    queryKey: ['videos', 'repository', repoId],
    queryFn: () =>
      requestVideos({
        page: 1,
        limit: 20,
        repositoryId: repoId,
        sortBy: 'created_at',
        sortOrder: 'desc',
      }),
  })

  const repository = repositoryQuery.data

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

      {repositoryQuery.isError ? (
        <section className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
          {getApiErrorMessage(repositoryQuery.error, 'Failed to load repository.')}
        </section>
      ) : null}

      {repository ? (
        <>
          <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="island-kicker mb-2">Repository</p>
              <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
                {repository.name}
              </h1>
              <p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
                {repository.description || 'No description provided.'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2 text-xs text-[var(--sea-ink-soft)]">
                <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1">
                  owner {repository.ownerId}
                </span>
                <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1">
                  {repository.visibility}
                </span>
                <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1">
                  my role {repository.myRole}
                </span>
              </div>
            </div>

            {repository.myRole === 'admin' ? (
              <Link to="/repositories/$repoId/settings" params={{ repoId: repository.id }} className="no-underline">
                <Button type="button" variant="outline">
                  <Settings size={16} aria-hidden="true" />
                  Repository settings
                </Button>
              </Link>
            ) : null}
          </header>

          <section className="island-shell rounded-2xl p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-[var(--sea-ink)]">Recent videos</h2>
                <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
                  Latest processed recordings for this repository.
                </p>
              </div>
              <span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-1 text-xs text-[var(--sea-ink-soft)]">
                {videosQuery.data?.total ?? 0} total
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
              <div className="grid gap-4 xl:grid-cols-2">
                {videosQuery.data.data.map((video) => (
                  <Link
                    key={video.id}
                    to="/repositories/$repoId/videos/$videoId"
                    params={{ repoId: repository.id, videoId: video.id }}
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
                            alt={video.id}
                            className="h-full w-full object-cover"
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
                          <div>
                            <dt className="font-semibold text-[var(--sea-ink)]">Created at</dt>
                            <dd>{formatDateTime(video.createdAt)}</dd>
                          </div>
                        </dl>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center">
                <h3 className="text-lg font-semibold text-[var(--sea-ink)]">No videos yet</h3>
                <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
                  Start an RTMP publish session into this repository to create the first recording.
                </p>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  )
}
