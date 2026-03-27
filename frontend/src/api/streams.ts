import { apiClient } from '#/api/client'

export interface ActiveStream {
  repositoryId: string
  repositoryName: string
  ownerId: string
  userId: string
  deviceType: string | null
  hlsUrl: string
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
    registeredAt: stream.registered_at,
  })) satisfies ActiveStream[]
}
