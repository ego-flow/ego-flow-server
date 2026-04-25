import { apiClient } from '#/api/client'

export interface LiveStreamSummary {
  streamId: string
  repositoryId: string
  repositoryName: string
  ownerId: string
  userId: string
  deviceType: string | null
  registeredAt: string
  status: 'live'
  hlsPath: string
}

export async function requestLiveStreams() {
  const response = await apiClient.get<{
    streams: Array<{
      stream_id: string
      repository_id: string
      repository_name: string
      owner_id: string
      user_id: string
      device_type: string | null
      registered_at: string
      status: 'live'
      hls_path: string
    }>
  }>('/live-streams')

  return response.data.streams.map((stream) => {
    return {
      streamId: stream.stream_id,
      repositoryId: stream.repository_id,
      repositoryName: stream.repository_name,
      ownerId: stream.owner_id,
      userId: stream.user_id,
      deviceType: stream.device_type,
      registeredAt: stream.registered_at,
      status: stream.status,
      hlsPath: stream.hls_path,
    }
  }) satisfies LiveStreamSummary[]
}
