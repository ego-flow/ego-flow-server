import { useEffect, useRef, useState } from 'react'
import type { ErrorData } from 'hls.js'

interface HlsPlayerProps {
  src: string | null
  playbackTicket?: string | null
  poster?: string
  className?: string
}

const appendSourceQueryParams = (requestUrl: string, sourceUrl: string) => {
  try {
    const source = new URL(sourceUrl, window.location.href)
    if (!source.search) {
      return requestUrl
    }

    const target = new URL(requestUrl, source)
    source.searchParams.forEach((value, key) => {
      if (!target.searchParams.has(key)) {
        target.searchParams.set(key, value)
      }
    })
    return target.toString()
  } catch {
    return requestUrl
  }
}

export default function HlsPlayer({ src, playbackTicket, poster, className }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    let isCancelled = false
    let cleanup: (() => void) | undefined

    setErrorMessage(null)

    if (!src) {
      video.removeAttribute('src')
      video.load()
      return
    }

    if (!playbackTicket && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      return () => {
        video.removeAttribute('src')
        video.load()
      }
    }

    void import('hls.js/light')
      .then(({ default: Hls }) => {
        if (isCancelled) {
          return
        }

        if (!Hls.isSupported()) {
          setErrorMessage('This browser does not support HLS playback.')
          return
        }

        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          xhrSetup: (xhr: XMLHttpRequest, url: string) => {
            xhr.withCredentials = false
            if (playbackTicket) {
              xhr.open('GET', appendSourceQueryParams(url, src), true)
            }
          },
        })

        hls.loadSource(src)
        hls.attachMedia(video)
        hls.on(Hls.Events.ERROR, (_event: string, data: ErrorData) => {
          if (data.fatal) {
            setErrorMessage('Failed to load the live stream.')
          }
        })

        cleanup = () => {
          hls.destroy()
          video.removeAttribute('src')
          video.load()
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setErrorMessage('Failed to load the live stream player.')
        }
      })

    return () => {
      isCancelled = true
      cleanup?.()
    }
  }, [src, playbackTicket])

  return (
    <div className={className}>
      <video
        ref={videoRef}
        controls
        playsInline
        autoPlay
        muted
        poster={poster}
        className="aspect-video w-full rounded-2xl border border-[var(--line)] bg-black"
      />
      {errorMessage ? (
        <p className="mt-3 text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
      ) : null}
    </div>
  )
}
