import type { QueryClient } from '@tanstack/react-query'

import { apiClient, resolveBackendUrl } from '#/api/client'

export type VideoStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
export type VideoSortBy = 'created_at' | 'recorded_at' | 'duration_sec'
export type SortOrder = 'asc' | 'desc'

export interface VideoListFilters {
  page?: number
  limit?: number
  videoKey?: string
  status?: VideoStatus | 'ALL'
  userId?: string
  sortBy?: VideoSortBy
  sortOrder?: SortOrder
}

interface VideoApiRecord {
  id: string
  video_key: string
  user_id: string
  status: VideoStatus
  duration_sec: number | null
  resolution_width: number | null
  resolution_height: number | null
  fps: number | null
  codec: string | null
  recorded_at: string | null
  thumbnail_url: string | null
  dashboard_video_url: string | null
  vlm_video_path: string | null
  scene_summary: string | null
  clip_segments: unknown
  created_at: string
}

interface VideoListApiResponse {
  total: number
  page: number
  limit: number
  data: VideoApiRecord[]
}

export interface VideoRecord {
  id: string
  videoKey: string
  userId: string
  status: VideoStatus
  durationSec: number | null
  resolutionWidth: number | null
  resolutionHeight: number | null
  fps: number | null
  codec: string | null
  recordedAt: string | null
  thumbnailUrl: string | null
  dashboardVideoUrl: string | null
  vlmVideoPath: string | null
  sceneSummary: string | null
  clipSegments: unknown
  createdAt: string
}

export interface VideoListResponse {
  total: number
  page: number
  limit: number
  data: VideoRecord[]
}

export interface VideoStatusResponse {
  id: string
  status: VideoStatus
  progress: number
  errorMessage: string | null
  processingStartedAt: string | null
  processingCompletedAt: string | null
}

function normalizeVideo(video: VideoApiRecord): VideoRecord {
  return {
    id: video.id,
    videoKey: video.video_key,
    userId: video.user_id,
    status: video.status,
    durationSec: video.duration_sec,
    resolutionWidth: video.resolution_width,
    resolutionHeight: video.resolution_height,
    fps: video.fps,
    codec: video.codec,
    recordedAt: video.recorded_at,
    thumbnailUrl: resolveBackendUrl(video.thumbnail_url),
    dashboardVideoUrl: resolveBackendUrl(video.dashboard_video_url),
    vlmVideoPath: video.vlm_video_path,
    sceneSummary: video.scene_summary,
    clipSegments: video.clip_segments,
    createdAt: video.created_at,
  }
}

export async function requestVideos(filters: VideoListFilters) {
  const response = await apiClient.get<VideoListApiResponse>('/videos', {
    params: {
      page: filters.page ?? 1,
      limit: filters.limit ?? 20,
      video_key: filters.videoKey || undefined,
      status:
        filters.status && filters.status !== 'ALL' ? filters.status : undefined,
      user_id: filters.userId || undefined,
      sort_by: filters.sortBy ?? 'created_at',
      sort_order: filters.sortOrder ?? 'desc',
    },
  })

  return {
    total: response.data.total,
    page: response.data.page,
    limit: response.data.limit,
    data: response.data.data.map(normalizeVideo),
  } satisfies VideoListResponse
}

export async function requestVideoStatus(videoId: string) {
  const response = await apiClient.get<{
    id: string
    status: VideoStatus
    progress: number
    error_message: string | null
    processing_started_at: string | null
    processing_completed_at: string | null
  }>(`/videos/${videoId}/status`)

  return {
    id: response.data.id,
    status: response.data.status,
    progress: response.data.progress,
    errorMessage: response.data.error_message,
    processingStartedAt: response.data.processing_started_at,
    processingCompletedAt: response.data.processing_completed_at,
  } satisfies VideoStatusResponse
}

export async function requestDeleteVideo(videoId: string) {
  const response = await apiClient.delete<{ id: string; deleted: boolean }>(
    `/videos/${videoId}`,
  )

  return response.data
}

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
    return 'Unavailable'
  }

  return parsed.toLocaleString()
}

export function formatResolution(video: Pick<VideoRecord, 'resolutionWidth' | 'resolutionHeight'>) {
  if (!video.resolutionWidth || !video.resolutionHeight) {
    return 'Unknown'
  }

  return `${video.resolutionWidth}x${video.resolutionHeight}`
}

export function findCachedVideo(queryClient: QueryClient, videoId: string) {
  const cachedLists = queryClient.getQueriesData<VideoListResponse>({
    queryKey: ['videos'],
  })

  for (const [, cachedList] of cachedLists) {
    const matchedVideo = cachedList?.data.find((video) => video.id === videoId)
    if (matchedVideo) {
      return matchedVideo
    }
  }

  return null
}
