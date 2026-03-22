import type { VideoRecord } from '#/api/videos'

const VIDEO_SNAPSHOT_STORAGE_KEY = 'ego-flow-video-snapshots'

function readSnapshotMap() {
  if (typeof window === 'undefined') {
    return {} as Record<string, VideoRecord>
  }

  try {
    const rawValue = window.sessionStorage.getItem(VIDEO_SNAPSHOT_STORAGE_KEY)
    if (!rawValue) {
      return {} as Record<string, VideoRecord>
    }

    return JSON.parse(rawValue) as Record<string, VideoRecord>
  } catch {
    return {} as Record<string, VideoRecord>
  }
}

function writeSnapshotMap(value: Record<string, VideoRecord>) {
  if (typeof window === 'undefined') {
    return
  }

  window.sessionStorage.setItem(VIDEO_SNAPSHOT_STORAGE_KEY, JSON.stringify(value))
}

export function saveVideoSnapshot(video: VideoRecord) {
  const nextSnapshots = readSnapshotMap()
  nextSnapshots[video.id] = video
  writeSnapshotMap(nextSnapshots)
}

export function readVideoSnapshot(videoId: string) {
  return readSnapshotMap()[videoId] ?? null
}

export function removeVideoSnapshot(videoId: string) {
  const nextSnapshots = readSnapshotMap()
  delete nextSnapshots[videoId]
  writeSnapshotMap(nextSnapshots)
}
