import { apiClient } from '#/api/client'

export interface ActiveStream {
  videoKey: string
  userId: string
  deviceType: string | null
  hlsUrl: string
  registeredAt: string
}

export async function requestActiveStreams() {
  const response = await apiClient.get<{
    streams: Array<{
      video_key: string
      user_id: string
      device_type: string | null
      hls_url: string
      registered_at: string
    }>
  }>('/streams/active')

  return response.data.streams.map((stream) => ({
    videoKey: stream.video_key,
    userId: stream.user_id,
    deviceType: stream.device_type,
    hlsUrl: stream.hls_url,
    registeredAt: stream.registered_at,
  })) satisfies ActiveStream[]
}
