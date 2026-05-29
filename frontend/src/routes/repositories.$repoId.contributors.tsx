import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeft, UsersRound } from 'lucide-react'

import { getApiErrorMessage } from '#/api/client'
import { requestRepositoryDetail } from '#/api/repositories'
import { requestVideos } from '#/api/videos'
import { formatDateTime } from '#/lib/format'
import { defaultRepositoryVideosSearch } from '#/lib/route-search'

export const Route = createFileRoute('/repositories/$repoId/contributors')({
  component: RepositoryContributorsPage,
})

function RepositoryContributorsPage() {
  const { repoId } = Route.useParams()

  const repositoryQuery = useQuery({
    queryKey: ['repository', repoId],
    queryFn: () => requestRepositoryDetail(repoId),
  })

  const contributorsQuery = useQuery({
    queryKey: ['videos', 'repository', repoId, 'contributors'],
    queryFn: () =>
      requestVideos(repoId, {
        ...defaultRepositoryVideosSearch,
        limit: 1,
      }),
  })

  const repository = repositoryQuery.data
  const contributors = contributorsQuery.data?.contributors ?? []

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <section className="island-shell mb-6 rounded-2xl p-3 shadow-sm">
        <Link
          to="/repositories/$repoId"
          params={{ repoId }}
          search={defaultRepositoryVideosSearch}
          className="inline-flex w-fit items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition-colors hover:bg-[var(--card)]"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to repository
        </Link>
      </section>

      {repositoryQuery.isError || contributorsQuery.isError ? (
        <section className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
          {repositoryQuery.isError
            ? getApiErrorMessage(repositoryQuery.error, 'Failed to load repository.')
            : getApiErrorMessage(contributorsQuery.error, 'Failed to load contributors.')}
        </section>
      ) : null}

      <section className="island-shell rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="island-kicker mb-2">Repository</p>
            <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
              Contributors
            </h1>
            <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
              {repository ? repository.name : 'Repository'} contributor list.
            </p>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-1 text-sm font-semibold text-[var(--sea-ink-soft)]">
            <UsersRound size={16} aria-hidden="true" />
            {contributors.length}
          </span>
        </div>

        {contributorsQuery.isPending ? (
          <div className="mt-6 rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center text-[var(--sea-ink-soft)]">
            Loading contributors...
          </div>
        ) : contributors.length > 0 ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {contributors.map((contributor) => (
              <article
                key={contributor.userId}
                className="rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] p-4"
              >
                <h2 className="truncate text-base font-semibold text-[var(--sea-ink)]">
                  {contributor.displayName || 'Unavailable'}
                </h2>
                <dl className="mt-4 grid gap-2 text-sm text-[var(--sea-ink-soft)]">
                  <div>
                    <dt className="font-semibold text-[var(--sea-ink)]">Videos</dt>
                    <dd>{contributor.videoCount}</dd>
                  </div>
                  <div>
                    <dt className="font-semibold text-[var(--sea-ink)]">Latest recorded</dt>
                    <dd>{formatDateTime(contributor.latestRecordedAt)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center text-sm text-[var(--sea-ink-soft)]">
            No contributors yet.
          </div>
        )}
      </section>
    </main>
  )
}
