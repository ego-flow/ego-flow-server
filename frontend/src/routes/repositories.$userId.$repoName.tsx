import { keepPreviousData, queryOptions, useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { Clock3, Copy, Database, HardDrive } from 'lucide-react'
import VideoCard from '#/components/VideoCard'

export const Route = createFileRoute('/repositories/$userId/$repoName')({
  validateSearch: (search: Record<string, unknown>) => {
    const pageValue = Number(search.page)
    const safePage = Number.isInteger(pageValue) && pageValue > 0 ? pageValue : 1
    return { page: safePage }
  },
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ context, params, deps }) =>
    context.queryClient.ensureQueryData(
      repositoryVideosQueryOptions({
        userId: params.userId,
        repoName: params.repoName,
        page: deps.page,
        pageSize: PAGE_SIZE,
      }),
    ),
  component: RepositoryPage,
})

const PAGE_SIZE = 14

interface RepositoryVideo {
  id: string
  title: string
  length: string
  size: string
  thumbnailUrl?: string
}

interface RepositoryVideosResponse {
  videos: RepositoryVideo[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
  repositorySizeMb: number
  repositoryHours: number
}

async function fetchRepositoryVideos({
  userId,
  repoName,
  page,
  pageSize,
}: {
  userId: string
  repoName: string
  page: number
  pageSize: number
}): Promise<RepositoryVideosResponse> {
  // Replace this mock with your real JSON API call.
  // Example:
  // const response = await fetch(
  //   `/api/repositories/${encodeURIComponent(userId)}/${encodeURIComponent(repoName)}/videos?page=${page}&pageSize=${pageSize}`,
  // )
  // if (!response.ok) throw new Error('Failed to load repository videos')
  // return (await response.json()) as RepositoryVideosResponse

  const totalPages = 209
  const totalCount = totalPages * pageSize
  const safePage = Math.min(Math.max(page, 1), totalPages)
  const startIndex = (safePage - 1) * pageSize

  const videos = Array.from({ length: pageSize }).map((_, index) => {
    const sequence = startIndex + index + 1
    return {
      id: `${userId}-${repoName}-video-${sequence}`,
      title: `Video ${sequence}: Repository Walkthrough`,
      length: `${10 + (sequence % 22)}:${((sequence * 7 + 12) % 60)
        .toString()
        .padStart(2, '0')}`,
      size: `${180 + (sequence % 15) * 16} MB`,
    }
  })

  const repositorySizeMb = Math.round(totalCount * 0.248)
  const repositoryHours = Number((totalCount * 0.063).toFixed(1))

  return {
    videos,
    page: safePage,
    pageSize,
    totalCount,
    totalPages,
    repositorySizeMb,
    repositoryHours,
  }
}

function repositoryVideosQueryOptions({
  userId,
  repoName,
  page,
  pageSize,
}: {
  userId: string
  repoName: string
  page: number
  pageSize: number
}) {
  return queryOptions({
    queryKey: ['repository-videos', userId, repoName, page, pageSize],
    queryFn: () => fetchRepositoryVideos({ userId, repoName, page, pageSize }),
  })
}

function getPaginationItems(currentPage: number, totalPages: number) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }).map((_, index) => index + 1)
  }

  const left = Math.max(2, currentPage - 1)
  const right = Math.min(totalPages - 1, currentPage + 1)
  const items: Array<number | 'ellipsis'> = [1]

  if (left > 2) {
    items.push('ellipsis')
  }

  for (let page = left; page <= right; page += 1) {
    items.push(page)
  }

  if (right < totalPages - 1) {
    items.push('ellipsis')
  }

  items.push(totalPages)
  return items
}

function RepositoryPage() {
  const { userId, repoName } = Route.useParams()
  const { page } = Route.useSearch()

  const {
    data: repositoryData,
    isPending,
    isError,
    error,
  } = useQuery({
    ...repositoryVideosQueryOptions({
      userId,
      repoName,
      page,
      pageSize: PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  })

  if (isPending || !repositoryData) {
    return (
      <main className="page-wrap px-4 py-8 sm:py-10">
        <p className="text-sm text-[var(--sea-ink-soft)]">Loading videos...</p>
      </main>
    )
  }

  if (isError) {
    return (
      <main className="page-wrap px-4 py-8 sm:py-10">
        <p className="text-sm text-[var(--destructive)]">
          Failed to load videos: {error.message}
        </p>
      </main>
    )
  }

  const pageItems = getPaginationItems(repositoryData.page, repositoryData.totalPages)
  const canGoPrev = repositoryData.page > 1
  const canGoNext = repositoryData.page < repositoryData.totalPages
  const repositoryFullName = `${userId}/${repoName}`

  const handleCopyRepositoryName = async () => {
    try {
      await navigator.clipboard.writeText(repositoryFullName)
    } catch {
      // no-op
    }
  }

  return (
    <main className="mx-auto w-full max-w-[84rem] px-4 py-8 sm:py-10">
      <header className="border-b border-[var(--line)] px-1 py-4 sm:py-5">
        <div className="flex items-center gap-2">
          <h1 className="inline-flex items-center gap-2 text-xl leading-none font-semibold tracking-[-0.02em] text-[var(--sea-ink)] sm:text-2xl">
            <Database size={22} aria-hidden="true" />
            {repositoryFullName}
          </h1>
          <button
            type="button"
            onClick={handleCopyRepositoryName}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[var(--line)] text-[var(--sea-ink-soft)] transition-colors hover:cursor-pointer hover:bg-[var(--link-bg-hover)] hover:text-[var(--sea-ink)]"
            aria-label={`Copy repository name ${repositoryFullName}`}
            title="Copy repository name"
          >
            <Copy size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="grid min-h-[38rem] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="border-b border-[var(--line)] py-5 pr-0 lg:border-b-0 lg:border-r lg:py-6 lg:pr-8">
          <h2 className="mb-4 text-lg font-semibold text-[var(--sea-ink)]">Videos</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
            {repositoryData.videos.map((video) => (
              <VideoCard
                key={video.id}
                title={video.title}
                length={video.length}
                size={video.size}
                thumbnailUrl={video.thumbnailUrl}
                className="max-w-none"
              />
            ))}
          </div>

          <nav
            className="mt-6 flex flex-wrap items-center justify-center gap-2 text-sm text-[var(--sea-ink-soft)]"
            aria-label="Video pagination"
          >
            {canGoPrev ? (
              <Link
                to="/repositories/$userId/$repoName"
                params={{ userId, repoName }}
                search={{ page: repositoryData.page - 1 }}
                className="h-8 rounded-md border border-transparent px-2 leading-8 hover:border-[var(--chip-line)] hover:bg-[var(--link-bg-hover)]"
              >
                Prev
              </Link>
            ) : (
              <span className="h-8 rounded-md px-2 leading-8 opacity-45">Prev</span>
            )}

            {pageItems.map((item, index) =>
              item === 'ellipsis' ? (
                <span key={`ellipsis-${index}`} className="px-1">
                  ...
                </span>
              ) : (
                <Link
                  key={item}
                  to="/repositories/$userId/$repoName"
                  params={{ userId, repoName }}
                  search={{ page: item }}
                  className={
                    item === repositoryData.page
                      ? 'h-8 min-w-8 rounded-md border border-[var(--line)] bg-[var(--chip-bg)] px-2 text-center font-semibold leading-8 text-[var(--sea-ink)]'
                      : 'h-8 min-w-8 rounded-md border border-transparent px-2 text-center leading-8 hover:border-[var(--chip-line)] hover:bg-[var(--link-bg-hover)]'
                  }
                >
                  {item}
                </Link>
              ),
            )}

            {canGoNext ? (
              <Link
                to="/repositories/$userId/$repoName"
                params={{ userId, repoName }}
                search={{ page: repositoryData.page + 1 }}
                className="h-8 rounded-md border border-transparent px-2 leading-8 hover:border-[var(--chip-line)] hover:bg-[var(--link-bg-hover)]"
              >
                Next
              </Link>
            ) : (
              <span className="h-8 rounded-md px-2 leading-8 opacity-45">Next</span>
            )}
          </nav>
        </div>

        <aside className="py-5 lg:py-6 lg:pl-8">
          <h2 className="mb-5 text-lg font-semibold text-[var(--sea-ink)]">Info</h2>
          <dl className="space-y-4 text-sm text-[var(--sea-ink-soft)] sm:text-base">
            <div className="flex items-start gap-3">
              <dt className="w-20 shrink-0 font-semibold text-[var(--sea-ink)]">
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <HardDrive size={16} aria-hidden="true" />
                  Size:
                </span>
              </dt>
              <dd>{repositoryData.repositorySizeMb.toLocaleString()} MB</dd>
            </div>
            <div className="flex items-start gap-3">
              <dt className="w-20 shrink-0 font-semibold text-[var(--sea-ink)]">
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <Clock3 size={16} aria-hidden="true" />
                  Hours:
                </span>
              </dt>
              <dd>{repositoryData.repositoryHours} hours</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  )
}
