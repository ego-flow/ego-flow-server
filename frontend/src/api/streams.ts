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
}

export interface LiveStreamPlaybackAuth {
  type: 'bearer'
  headerName: string
  scheme: string
  token: string
  expiresInSeconds: number
}

export interface LiveStreamPlayback {
  streamId: string
  repositoryId: string
  repositoryName: string
  protocol: 'hls'
  hlsUrl: string
  auth: LiveStreamPlaybackAuth
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
    }>
  }>('/live-streams')

  return response.data.streams.map((stream) => ({
    streamId: stream.stream_id,
    repositoryId: stream.repository_id,
    repositoryName: stream.repository_name,
    ownerId: stream.owner_id,
    userId: stream.user_id,
    deviceType: stream.device_type,
    registeredAt: stream.registered_at,
    status: stream.status,
  })) satisfies LiveStreamSummary[]
}

export async function requestLiveStreamPlayback(streamId: string) {
  const response = await apiClient.get<{
    stream_id: string
    repository_id: string
    repository_name: string
    protocol: 'hls'
    hls_url: string
    auth: {
      type: 'bearer'
      header_name: string
      scheme: string
      token: string
      expires_in_seconds: number
    }
  }>(`/live-streams/${streamId}/playback`)

  const data = response.data
  return {
    streamId: data.stream_id,
    repositoryId: data.repository_id,
    repositoryName: data.repository_name,
    protocol: data.protocol,
    hlsUrl: data.hls_url,
    auth: {
      type: data.auth.type,
      headerName: data.auth.header_name,
      scheme: data.auth.scheme,
      token: data.auth.token,
      expiresInSeconds: data.auth.expires_in_seconds,
    },
  } satisfies LiveStreamPlayback
}
