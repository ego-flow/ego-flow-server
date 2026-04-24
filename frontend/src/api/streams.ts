import { apiClient } from '#/api/client'

export interface ActiveStream {
  repositoryId: string
  repositoryName: string
  ownerId: string
  userId: string
  deviceType: string | null
  hlsUrl: string
  hlsPlaybackToken: string
  hlsPlaybackTokenExpiresInSeconds: number
  registeredAt: string
}

export async function requestActiveStreams() {
  const response = await apiClient.get<{
    streams: Array<{
      repository_id: string
      repository_name: string
      owner_id: string
      user_id: string
      device_type: string | null
      hls_url: string
      hls_playback_token: string
      hls_playback_token_expires_in_seconds: number
      registered_at: string
    }>
  }>('/streams/active')

  return response.data.streams.map((stream) => ({
    repositoryId: stream.repository_id,
    repositoryName: stream.repository_name,
    ownerId: stream.owner_id,
    userId: stream.user_id,
    deviceType: stream.device_type,
    hlsUrl: stream.hls_url,
    hlsPlaybackToken: stream.hls_playback_token,
    hlsPlaybackTokenExpiresInSeconds: stream.hls_playback_token_expires_in_seconds,
    registeredAt: stream.registered_at,
  })) satisfies ActiveStream[]
}
