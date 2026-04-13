export function formatDuration(durationSec: number | null) {
  if (typeof durationSec !== 'number' || Number.isNaN(durationSec)) {
    return 'Unknown length'
  }

  const totalSeconds = Math.max(0, Math.round(durationSec))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`
  }

  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

export function formatDateTime(value: string | null) {
  if (!value) {
    return 'Unavailable'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString()
}

export function formatResolution(
  video: { resolutionWidth: number | null; resolutionHeight: number | null },
) {
  if (!video.resolutionWidth || !video.resolutionHeight) {
    return 'Unavailable'
  }

  return `${video.resolutionWidth} × ${video.resolutionHeight}`
}
