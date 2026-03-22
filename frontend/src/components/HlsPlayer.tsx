import { useEffect, useRef, useState } from 'react'
import Hls from 'hls.js'

interface HlsPlayerProps {
  src: string | null
  poster?: string
  className?: string
}

export default function HlsPlayer({ src, poster, className }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video) {
      return
    }

    setErrorMessage(null)

    if (!src) {
      video.removeAttribute('src')
      video.load()
      return
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      return () => {
        video.removeAttribute('src')
        video.load()
      }
    }

    if (!Hls.isSupported()) {
      setErrorMessage('This browser does not support HLS playback.')
      return
    }

    const hls = new Hls({
      enableWorker: true,
      lowLatencyMode: true,
    })

    hls.loadSource(src)
    hls.attachMedia(video)
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal) {
        setErrorMessage('Failed to load the live stream.')
      }
    })

    return () => {
      hls.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [src])

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
