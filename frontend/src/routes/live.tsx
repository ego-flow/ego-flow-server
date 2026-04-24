import { Suspense, lazy, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, createFileRoute } from '@tanstack/react-router'
import { Activity, RadioTower, RefreshCcw } from 'lucide-react'

import { getApiErrorMessage } from '#/api/client'
import { requestLiveStreamPlayback, requestLiveStreams } from '#/api/streams'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/hooks/useAuth'
import { formatDateTime } from '#/lib/format'

const HlsPlayer = lazy(() => import('#/components/HlsPlayer'))

export const Route = createFileRoute('/live')({
  component: LivePage,
})

function LivePage() {
  const { isReady, isAuthenticated, session } = useAuth()
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null)

  const streamsQuery = useQuery({
    queryKey: ['live-streams'],
    queryFn: requestLiveStreams,
    enabled: isReady && isAuthenticated,
    refetchInterval: 5000,
  })

  useEffect(() => {
    const streams = streamsQuery.data ?? []
    if (streams.length === 0) {
      setSelectedStreamId(null)
      return
    }

    const selectedExists = streams.some((stream) => stream.streamId === selectedStreamId)
    if (!selectedExists) {
      setSelectedStreamId(streams[0].streamId)
    }
  }, [selectedStreamId, streamsQuery.data])

  const playbackQuery = useQuery({
    queryKey: ['live-stream-playback', selectedStreamId],
    queryFn: () => requestLiveStreamPlayback(selectedStreamId as string),
    enabled: Boolean(selectedStreamId),
    // playback token TTL은 5분. 만료 전에 rotate하도록 4분마다 재발급.
    refetchInterval: 4 * 60 * 1000,
  })

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  const streams = streamsQuery.data ?? []
  const selectedStream =
    streams.find((stream) => stream.streamId === selectedStreamId) ?? null
  const playback = playbackQuery.data ?? null
  const isAdmin = session?.user.role === 'admin'

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="island-kicker mb-2">Live</p>
          <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
            Stream Monitor
          </h1>
          <p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
            Watch active HLS streams and inspect incoming sessions in real time.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-2 text-sm text-[var(--sea-ink-soft)]">
            {streams.length} active stream{streams.length === 1 ? '' : 's'}
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void streamsQuery.refetch()
            }}
            disabled={streamsQuery.isFetching}
          >
            <RefreshCcw size={16} aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </header>

      {streamsQuery.isError ? (
        <section className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
          {getApiErrorMessage(streamsQuery.error, 'Failed to load active streams.')}
        </section>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
        <aside className="island-shell rounded-2xl p-4 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <RadioTower size={18} aria-hidden="true" className="text-[var(--lagoon-deep)]" />
            <h2 className="text-lg font-semibold text-[var(--sea-ink)]">Active Sessions</h2>
          </div>

          {streamsQuery.isPending ? (
            <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-10 text-center text-sm text-[var(--sea-ink-soft)]">
              Loading streams...
            </div>
          ) : streams.length > 0 ? (
            <div className="space-y-3">
              {streams.map((stream) => (
                <button
                  key={stream.streamId}
                  type="button"
                  onClick={() => setSelectedStreamId(stream.streamId)}
                  className={`w-full rounded-2xl border p-4 text-left transition-colors ${
                    selectedStreamId === stream.streamId
                      ? 'border-[color-mix(in_oklab,var(--lagoon-deep)_55%,var(--line))] bg-[var(--link-bg-hover)]'
                      : 'border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_86%,transparent)] hover:bg-[var(--link-bg-hover)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="truncate text-base font-semibold text-[var(--sea-ink)]">
                      {stream.repositoryName}
                    </h3>
                    <span className="rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                      LIVE
                    </span>
                  </div>
                  <dl className="mt-3 grid gap-2 text-sm text-[var(--sea-ink-soft)]">
                    <div>
                      <dt className="font-semibold text-[var(--sea-ink)]">Publisher</dt>
                      <dd>{stream.userId}</dd>
                    </div>
                    <div>
                      <dt className="font-semibold text-[var(--sea-ink)]">Owner</dt>
                      <dd>{stream.ownerId}</dd>
                    </div>
                    {isAdmin ? (
                      <div>
                        <dt className="font-semibold text-[var(--sea-ink)]">Device</dt>
                        <dd>{stream.deviceType || 'Unknown'}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt className="font-semibold text-[var(--sea-ink)]">Registered</dt>
                      <dd>{formatDateTime(stream.registeredAt)}</dd>
                    </div>
                  </dl>
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-10 text-center">
              <Activity size={24} aria-hidden="true" className="mx-auto text-[var(--sea-ink-soft)]" />
              <h3 className="mt-3 text-base font-semibold text-[var(--sea-ink)]">
                No active streams
              </h3>
              <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
                New publishing sessions will appear here automatically.
              </p>
            </div>
          )}
        </aside>

        <section className="island-shell rounded-2xl p-5 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--sea-ink)]">Live Playback</h2>
              <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
                {selectedStream
                  ? `${selectedStream.ownerId} / ${selectedStream.repositoryName}`
                  : 'Select an active stream to begin playback.'}
              </p>
            </div>
            {selectedStream ? (
              <span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-1 text-xs text-[var(--sea-ink-soft)]">
                {selectedStream.deviceType || 'Unknown device'}
              </span>
            ) : null}
          </div>

          {selectedStream ? (
            playbackQuery.isError ? (
              <section className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
                {getApiErrorMessage(playbackQuery.error, 'Failed to load playback info.')}
              </section>
            ) : playback ? (
              <>
                <Suspense
                  fallback={
                    <div className="grid aspect-video place-items-center rounded-2xl border border-[var(--line)] bg-black text-sm text-white/70">
                      Loading live player...
                    </div>
                  }
                >
                  <HlsPlayer src={playback.hlsUrl} playbackToken={playback.auth.token} />
                </Suspense>
                <dl className="mt-5 grid gap-3 text-sm text-[var(--sea-ink-soft)] sm:grid-cols-2">
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3">
                    <dt className="font-semibold text-[var(--sea-ink)]">HLS URL</dt>
                    <dd className="mt-1 break-all">{playback.hlsUrl}</dd>
                  </div>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3">
                    <dt className="font-semibold text-[var(--sea-ink)]">Registered at</dt>
                    <dd className="mt-1">{formatDateTime(selectedStream.registeredAt)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <div className="grid aspect-video place-items-center rounded-2xl border border-[var(--line)] bg-black text-sm text-white/70">
                Loading playback info...
              </div>
            )
          ) : (
            <div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-[var(--line)] px-6 text-center">
              <div>
                <h3 className="text-base font-semibold text-[var(--sea-ink)]">
                  Waiting for stream selection
                </h3>
                <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
                  Start a publishing session from the app, then pick it from the list.
                </p>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}
