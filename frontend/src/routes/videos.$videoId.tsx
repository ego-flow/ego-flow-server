import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Trash2 } from 'lucide-react'

import {
  findCachedVideo,
  formatDateTime,
  formatDuration,
  formatResolution,
  requestDeleteVideo,
  requestVideoStatus,
  type VideoRecord,
} from '#/api/videos'
import { getApiErrorMessage } from '#/api/client'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/hooks/useAuth'
import { readVideoSnapshot, removeVideoSnapshot } from '#/lib/video-snapshots'

export const Route = createFileRoute('/videos/$videoId')({
  component: VideoDetailPage,
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

function formatClipSegments(value: unknown) {
  if (!value) {
    return 'None'
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return 'Unavailable'
  }
}

function VideoDetailPage() {
  const { videoId } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { isReady, isAuthenticated } = useAuth()
  const [video, setVideo] = useState<VideoRecord | null>(() => readVideoSnapshot(videoId))

  useEffect(() => {
    const cachedVideo = findCachedVideo(queryClient, videoId) ?? readVideoSnapshot(videoId)
    if (cachedVideo) {
      setVideo(cachedVideo)
    }
  }, [queryClient, videoId])

  const statusQuery = useQuery({
    queryKey: ['video-status', videoId],
    queryFn: () => requestVideoStatus(videoId),
    enabled: isReady && isAuthenticated,
    refetchInterval: (query) =>
      query.state.data?.status === 'PROCESSING' || query.state.data?.status === 'PENDING'
        ? 5000
        : false,
  })

  const deleteMutation = useMutation({
    mutationFn: () => requestDeleteVideo(videoId),
    onSuccess: async () => {
      removeVideoSnapshot(videoId)
      await queryClient.invalidateQueries({ queryKey: ['videos'] })
      await navigate({ to: '/videos' })
    },
  })

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  const currentStatus = statusQuery.data?.status ?? video?.status ?? 'PENDING'

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <div className="mb-5 flex items-center justify-between">
        <Link
          to="/videos"
          className="text-sm font-semibold text-[var(--lagoon-deep)] no-underline hover:underline"
        >
          Back to videos
        </Link>
        <Button
          type="button"
          variant="destructive"
          disabled={deleteMutation.isPending}
          onClick={() => {
            if (!window.confirm('Delete this video and remove all generated files?')) {
              return
            }

            deleteMutation.mutate()
          }}
        >
          <Trash2 size={16} aria-hidden="true" />
          Delete
        </Button>
      </div>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
        <article className="island-shell rounded-2xl p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClassName(currentStatus)}`}>
              {currentStatus}
            </span>
            {statusQuery.data ? (
              <span className="text-sm text-[var(--sea-ink-soft)]">
                Progress {statusQuery.data.progress}%
              </span>
            ) : null}
          </div>

          <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
            {video?.videoKey || 'Video detail'}
          </h1>
          <p className="mt-2 break-all text-sm text-[var(--sea-ink-soft)]">{videoId}</p>

          <div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-black">
            {video?.dashboardVideoUrl && currentStatus === 'COMPLETED' ? (
              <video
                key={video.dashboardVideoUrl}
                src={video.dashboardVideoUrl}
                controls
                playsInline
                className="aspect-video w-full"
              />
            ) : (
              <div className="grid aspect-video place-items-center px-6 text-center text-sm text-white/70">
                <div>
                  <p className="font-semibold">Playback is not available yet.</p>
                  <p className="mt-2">
                    Completed dashboard media appears here after processing finishes.
                  </p>
                </div>
              </div>
            )}
          </div>

          {deleteMutation.isError ? (
            <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/6 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {getApiErrorMessage(deleteMutation.error, 'Failed to delete video.')}
            </div>
          ) : null}

          {statusQuery.isError ? (
            <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/6 px-4 py-3 text-sm text-red-700 dark:text-red-300">
              {getApiErrorMessage(statusQuery.error, 'Failed to load processing status.')}
            </div>
          ) : null}

          {!video ? (
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/8 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              <p>
                Detailed metadata is available when this page is opened from the video list.
                Processing status still updates from the backend.
              </p>
            </div>
          ) : null}
        </article>

        <aside className="space-y-6">
          <section className="island-shell rounded-2xl p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[var(--sea-ink)]">Metadata</h2>
            <dl className="mt-4 space-y-3 text-sm text-[var(--sea-ink-soft)]">
              <div>
                <dt className="font-semibold text-[var(--sea-ink)]">User</dt>
                <dd>{video?.userId || 'Unavailable'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--sea-ink)]">Duration</dt>
                <dd>{formatDuration(video?.durationSec ?? null)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--sea-ink)]">Resolution</dt>
                <dd>{video ? formatResolution(video) : 'Unavailable'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--sea-ink)]">FPS</dt>
                <dd>{video?.fps ?? 'Unavailable'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--sea-ink)]">Codec</dt>
                <dd>{video?.codec || 'Unavailable'}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--sea-ink)]">Recorded at</dt>
                <dd>{formatDateTime(video?.recordedAt ?? null)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--sea-ink)]">Created at</dt>
                <dd>{formatDateTime(video?.createdAt ?? null)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--sea-ink)]">Processing started</dt>
                <dd>{formatDateTime(statusQuery.data?.processingStartedAt ?? null)}</dd>
              </div>
              <div>
                <dt className="font-semibold text-[var(--sea-ink)]">Processing completed</dt>
                <dd>{formatDateTime(statusQuery.data?.processingCompletedAt ?? null)}</dd>
              </div>
            </dl>
          </section>

          <section className="island-shell rounded-2xl p-5 shadow-sm">
            <h2 className="text-lg font-semibold text-[var(--sea-ink)]">Analysis</h2>
            <div className="mt-4 space-y-4 text-sm text-[var(--sea-ink-soft)]">
              <div>
                <h3 className="font-semibold text-[var(--sea-ink)]">Scene summary</h3>
                <p className="mt-1 whitespace-pre-wrap">
                  {video?.sceneSummary || 'No summary generated yet.'}
                </p>
              </div>
              <div>
                <h3 className="font-semibold text-[var(--sea-ink)]">Clip segments</h3>
                <pre className="mt-1 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-3 text-xs">
                  {formatClipSegments(video?.clipSegments)}
                </pre>
              </div>
              {statusQuery.data?.errorMessage ? (
                <div>
                  <h3 className="font-semibold text-[var(--sea-ink)]">Processing error</h3>
                  <p className="mt-1 text-red-700 dark:text-red-300">
                    {statusQuery.data.errorMessage}
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        </aside>
      </section>
    </main>
  )
}
