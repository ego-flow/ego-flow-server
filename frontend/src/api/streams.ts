import { apiClient } from "#/api/client";
import { ApiEndpoint } from "#/constants/api/api-constants";

export interface LiveStreamSummary {
	streamId: string;
	repositoryId: string;
	repositoryName: string;
	userId: string;
	deviceType: string | null;
	status: "live";
	hlsPath: string;
	whepPath: string;
}

export async function requestLiveStreams() {
	const response = await apiClient.get<{
		streams: Array<{
			stream_id: string;
			repository_id: string;
			repository_name: string;
			user_id: string;
			device_type: string | null;
			status: "live";
			hls_path: string;
			whep_path: string;
		}>;
	}>(ApiEndpoint.LiveStreams);

	return response.data.streams.map((stream) => {
		return {
			streamId: stream.stream_id,
			repositoryId: stream.repository_id,
			repositoryName: stream.repository_name,
			userId: stream.user_id,
			deviceType: stream.device_type,
			status: stream.status,
			hlsPath: stream.hls_path,
			whepPath: stream.whep_path,
		};
	}) satisfies LiveStreamSummary[];
}
