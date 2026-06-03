import { apiClient } from "#/api/client";
import { ApiEndpoint } from "#/constants/api/api-constants";
import { liveStreamPath, liveStreamPlaybackTicketPath } from "#/utils/api-paths";

export interface LiveStreamSummary {
	recordingSessionId: string;
	repositoryId: string;
	repositoryName: string;
	userId: string;
	deviceType: string | null;
	ingestType: "MEDIAMTX" | "HTTP";
	streamPath: string;
	status: "live";
	playbackAvailable: boolean;
}

export interface LiveStreamDetail extends LiveStreamSummary {
	ownerId: string;
	streamPath: string;
	registeredAt: string;
	playbackReady: boolean;
	bytesReceived: number | null;
	lastSequence: number | null;
	lastChunkAt: string | null;
}

export interface LiveStreamPlaybackTicket {
	playbackTicket: string;
}

interface LiveStreamSummaryApiRecord {
	recording_session_id: string;
	repository_id: string;
	repository_name: string;
	user_id: string;
	device_type: string | null;
	ingest_type: "MEDIAMTX" | "HTTP";
	stream_path: string;
	status: "live";
	playback_available: boolean;
}

interface LiveStreamDetailApiRecord {
	recording_session_id: string;
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
	playback_ready: boolean;
	bytes_received: number | null;
	last_sequence: number | null;
	last_chunk_at: string | null;
}

const normalizeLiveStreamSummary = (
	stream: LiveStreamSummaryApiRecord,
): LiveStreamSummary => ({
	recordingSessionId: stream.recording_session_id,
	repositoryId: stream.repository_id,
	repositoryName: stream.repository_name,
	userId: stream.user_id,
	deviceType: stream.device_type,
	ingestType: stream.ingest_type,
	streamPath: stream.stream_path,
	status: stream.status,
	playbackAvailable: stream.playback_available,
});

const normalizeLiveStreamDetail = (
	stream: LiveStreamDetailApiRecord,
): LiveStreamDetail => ({
	recordingSessionId: stream.recording_session_id,
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
	playbackReady: stream.playback_ready,
	bytesReceived: stream.bytes_received,
	lastSequence: stream.last_sequence,
	lastChunkAt: stream.last_chunk_at,
});

export async function requestLiveStreams() {
	const response = await apiClient.get<{
		streams: LiveStreamSummaryApiRecord[];
	}>(ApiEndpoint.LiveStreams);

	return response.data.streams.map(
		normalizeLiveStreamSummary,
	) satisfies LiveStreamSummary[];
}

export async function requestLiveStreamDetail(recordingSessionId: string) {
	const response = await apiClient.get<LiveStreamDetailApiRecord>(
		liveStreamPath(recordingSessionId),
	);

	return normalizeLiveStreamDetail(response.data);
}

export async function requestLiveStreamPlaybackTicket(recordingSessionId: string) {
	const response = await apiClient.post<{
		playback_ticket: string;
	}>(liveStreamPlaybackTicketPath(recordingSessionId));

	return {
		playbackTicket: response.data.playback_ticket,
	} satisfies LiveStreamPlaybackTicket;
}
