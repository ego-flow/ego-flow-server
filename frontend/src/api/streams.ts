import { apiClient } from "#/api/client";
import { ApiEndpoint } from "#/constants/api/api-constants";
import { liveStreamPath } from "#/utils/api-paths";

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

export interface LiveStreamDetail extends LiveStreamSummary {
	ownerId: string;
	streamPath: string;
	registeredAt: string;
	playbackReady: boolean;
}

interface LiveStreamSummaryApiRecord {
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
}

interface LiveStreamDetailApiRecord {
	stream_id: string;
	repository_id: string;
	repository_name: string;
	owner_id: string;
	user_id: string;
	device_type: string | null;
	ingest_type: "MEDIAMTX" | "HTTP";
	stream_path: string;
	registered_at: string;
	status: "live";
	playback_available: boolean;
	hls_path: string | null;
	playback_ready: boolean;
}

const normalizeLiveStreamSummary = (
	stream: LiveStreamSummaryApiRecord,
): LiveStreamSummary => ({
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
});

const normalizeLiveStreamDetail = (
	stream: LiveStreamDetailApiRecord,
): LiveStreamDetail => ({
	streamId: stream.stream_id,
	repositoryId: stream.repository_id,
	repositoryName: stream.repository_name,
	ownerId: stream.owner_id,
	userId: stream.user_id,
	deviceType: stream.device_type,
	ingestType: stream.ingest_type,
	streamPath: stream.stream_path,
	registeredAt: stream.registered_at,
	status: stream.status,
	playbackAvailable: stream.playback_available,
	hlsPath: stream.hls_path,
	playbackReady: stream.playback_ready,
	bytesReceived: null,
	lastSequence: null,
	lastChunkAt: null,
});

export async function requestLiveStreams() {
	const response = await apiClient.get<{
		streams: LiveStreamSummaryApiRecord[];
	}>(ApiEndpoint.LiveStreams);

	return response.data.streams.map(
		normalizeLiveStreamSummary,
	) satisfies LiveStreamSummary[];
}

export async function requestLiveStreamDetail(streamId: string) {
	const response = await apiClient.get<LiveStreamDetailApiRecord>(
		liveStreamPath(streamId),
	);

	return normalizeLiveStreamDetail(response.data);
}
