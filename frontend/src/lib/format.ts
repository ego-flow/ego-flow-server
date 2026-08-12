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

export function formatBytes(sizeBytes: number | null) {
  if (typeof sizeBytes !== 'number' || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
    return 'Unavailable'
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = sizeBytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const fractionDigits = unitIndex === 0 || value >= 10 ? 0 : 1
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`
}
