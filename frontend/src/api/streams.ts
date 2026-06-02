import { apiClient } from "#/api/client";
import { ApiEndpoint } from "#/constants/api/api-constants";

export interface LiveStreamSummary {
	streamId: string;
	repositoryId: string;
	repositoryName: string;
	userId: string;
	deviceType: string | null;
	ingestType: "MEDIAMTX" | "HTTP";
	status: "live";
	playbackAvailable: boolean;
	hlsPath: string | null;
	bytesReceived: number | null;
	lastSequence: number | null;
	lastChunkAt: string | null;
}

export async function requestLiveStreams() {
	const response = await apiClient.get<{
		streams: Array<{
			stream_id: string;
			repository_id: string;
			repository_name: string;
			user_id: string;
			device_type: string | null;
			ingest_type: "MEDIAMTX" | "HTTP";
			status: "live";
			playback_available: boolean;
			hls_path: string | null;
			bytes_received: number | null;
			last_sequence: number | null;
			last_chunk_at: string | null;
		}>;
	}>(ApiEndpoint.LiveStreams);

	return response.data.streams.map((stream) => {
		return {
			streamId: stream.stream_id,
			repositoryId: stream.repository_id,
			repositoryName: stream.repository_name,
			userId: stream.user_id,
			deviceType: stream.device_type,
			ingestType: stream.ingest_type,
			status: stream.status,
			playbackAvailable: stream.playback_available,
			hlsPath: stream.hls_path,
			bytesReceived: stream.bytes_received,
			lastSequence: stream.last_sequence,
			lastChunkAt: stream.last_chunk_at,
		};
	}) satisfies LiveStreamSummary[];
}
