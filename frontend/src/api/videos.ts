import { apiClient, resolveBackendUrl } from "#/api/client";
import {
	CONTENT_DISPOSITION_ENCODED_FILENAME_PATTERN,
	CONTENT_DISPOSITION_PLAIN_FILENAME_PATTERN,
	CONTENT_TYPE_EXTENSION_MAP,
	DEFAULT_VIDEO_EXTENSION,
	DEFAULT_VIDEO_FILENAME_BASE,
	DEFAULT_VIDEO_LIMIT,
	DEFAULT_VIDEO_PAGE,
	DEFAULT_VIDEO_SORT_BY,
	DEFAULT_VIDEO_SORT_ORDER,
	FILENAME_EXTENSION_PATTERN,
	type SortOrder,
	TRIM_DASH_PATTERN,
	UNSAFE_FILENAME_CHARS_PATTERN,
	type VideoSortBy,
	type VideoStatus,
	VideoStatusFilter,
} from "#/constants/video/video-constants";
import {
	repositoryVideoDownloadPath,
	repositoryVideoPath,
	repositoryVideoStatusPath,
	repositoryVideosPath,
} from "#/utils/api-paths";

export {
	SortOrder,
	VideoSortBy,
	VideoStatus,
	VideoStatusFilter,
} from "#/constants/video/video-constants";

export interface VideoListFilters {
	page?: number;
	limit?: number;
	status?: VideoStatus | VideoStatusFilter;
	sortBy?: VideoSortBy;
	sortOrder?: SortOrder;
	contributorUserId?: string;
}

export interface VideoProcessingProgress {
	currentStep: number;
	totalSteps: number;
	task: string;
	label: string;
}

interface VideoProcessingProgressApiRecord {
	current_step: number;
	total_steps: number;
	task: string;
	label: string;
}

export enum VideoSemanticMetadataStatus {
	Pending = "PENDING",
	Processing = "PROCESSING",
	Completed = "COMPLETED",
	Failed = "FAILED",
}

interface VideoSemanticMetadataApiRecord {
	video_id: string;
	status: VideoSemanticMetadataStatus;
	clip_segments: unknown;
	action_labels: unknown;
	video_text_alignment: unknown;
	scene_summary: string | null;
	error_message: string | null;
	processing_started_at: string | null;
	processing_completed_at: string | null;
	created_at: string;
	updated_at: string;
}

interface RepositoryVideoApiRecord {
	id: string;
	repository_id: string;
	repository_name: string;
	owner_id: string;
	status: VideoStatus;
	duration_sec: number | null;
	resolution_width: number | null;
	resolution_height: number | null;
	fps: number | null;
	codec: string | null;
	recorded_at: string | null;
	size_bytes: number | null;
	contributor_user_id: string | null;
	contributor_display_name: string | null;
	thumbnail_url: string | null;
	processing_progress: VideoProcessingProgressApiRecord | null;
	dashboard_video_url?: string | null;
	scene_summary: string | null;
	clip_segments: unknown;
	semantic_metadata: VideoSemanticMetadataApiRecord | null;
	created_at: string;
}

interface VideoListApiResponse {
	total: number;
	page: number;
	limit: number;
	data: RepositoryVideoApiRecord[];
	contributors: Array<{
		user_id: string;
		display_name: string;
		video_count: number;
		latest_recorded_at: string | null;
	}>;
}

export interface VideoContributor {
	userId: string;
	displayName: string;
	videoCount: number;
	latestRecordedAt: string | null;
}

export interface VideoSemanticMetadata {
	videoId: string;
	status: VideoSemanticMetadataStatus;
	clipSegments: unknown;
	actionLabels: unknown;
	videoTextAlignment: unknown;
	sceneSummary: string | null;
	errorMessage: string | null;
	processingStartedAt: string | null;
	processingCompletedAt: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface VideoRecord {
	id: string;
	repositoryId: string;
	repositoryName: string;
	ownerId: string;
	status: VideoStatus;
	durationSec: number | null;
	resolutionWidth: number | null;
	resolutionHeight: number | null;
	fps: number | null;
	codec: string | null;
	recordedAt: string | null;
	sizeBytes: number | null;
	contributorUserId: string | null;
	contributorDisplayName: string | null;
	thumbnailUrl: string | null;
	processingProgress: VideoProcessingProgress | null;
	dashboardVideoUrl: string | null;
	sceneSummary: string | null;
	clipSegments: unknown;
	semanticMetadata: VideoSemanticMetadata | null;
	createdAt: string;
}

export interface VideoListResponse {
	total: number;
	page: number;
	limit: number;
	contributors: VideoContributor[];
	data: VideoRecord[];
}

export interface VideoStatusResponse {
	id: string;
	repositoryId: string;
	status: VideoStatus;
	progress: VideoProcessingProgress | null;
	errorMessage: string | null;
	processingStartedAt: string | null;
	processingCompletedAt: string | null;
}

export interface VideoDownloadResponse {
	blob: Blob;
	fileName: string;
}

function sanitizeFilenamePart(value: string | null | undefined) {
	const sanitized = (value ?? "")
		.trim()
		.replace(UNSAFE_FILENAME_CHARS_PATTERN, "-")
		.replace(TRIM_DASH_PATTERN, "");

	return sanitized || DEFAULT_VIDEO_FILENAME_BASE;
}

function inferExtension(contentType: string | null | undefined) {
	const normalized = contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	return CONTENT_TYPE_EXTENSION_MAP[normalized] ?? DEFAULT_VIDEO_EXTENSION;
}

function ensureFilenameExtension(fileName: string, extension: string) {
	return FILENAME_EXTENSION_PATTERN.test(fileName)
		? fileName
		: `${fileName}.${extension}`;
}

function getFilenameFromContentDisposition(header: string | null | undefined) {
	if (!header) {
		return null;
	}

	const encodedMatch = header.match(
		CONTENT_DISPOSITION_ENCODED_FILENAME_PATTERN,
	);
	if (encodedMatch?.[1]) {
		try {
			return decodeURIComponent(encodedMatch[1].trim().replace(/^"|"$/g, ""));
		} catch {
			return encodedMatch[1].trim().replace(/^"|"$/g, "");
		}
	}

	const plainMatch = header.match(CONTENT_DISPOSITION_PLAIN_FILENAME_PATTERN);
	return plainMatch?.[2]?.trim() || null;
}

function getFilenameFromResponseUrl(request: unknown) {
	const responseUrl =
		typeof request === "object" && request && "responseURL" in request
			? request.responseURL
			: null;

	if (typeof responseUrl !== "string" || !responseUrl) {
		return null;
	}

	try {
		const pathname = new URL(responseUrl).pathname;
		const lastSegment = pathname.split("/").filter(Boolean).pop();
		return lastSegment ? decodeURIComponent(lastSegment) : null;
	} catch {
		return null;
	}
}

function normalizeProcessingProgress(
	progress: VideoProcessingProgressApiRecord | null,
): VideoProcessingProgress | null {
	if (!progress) {
		return null;
	}

	return {
		currentStep: progress.current_step,
		totalSteps: progress.total_steps,
		task: progress.task,
		label: progress.label,
	};
}

function normalizeSemanticMetadata(
	semanticMetadata: VideoSemanticMetadataApiRecord | null,
): VideoSemanticMetadata | null {
	if (!semanticMetadata) {
		return null;
	}

	return {
		videoId: semanticMetadata.video_id,
		status: semanticMetadata.status,
		clipSegments: semanticMetadata.clip_segments,
		actionLabels: semanticMetadata.action_labels,
		videoTextAlignment: semanticMetadata.video_text_alignment,
		sceneSummary: semanticMetadata.scene_summary,
		errorMessage: semanticMetadata.error_message,
		processingStartedAt: semanticMetadata.processing_started_at,
		processingCompletedAt: semanticMetadata.processing_completed_at,
		createdAt: semanticMetadata.created_at,
		updatedAt: semanticMetadata.updated_at,
	};
}

function normalizeVideo(video: RepositoryVideoApiRecord): VideoRecord {
	return {
		id: video.id,
		repositoryId: video.repository_id,
		repositoryName: video.repository_name,
		ownerId: video.owner_id,
		status: video.status,
		durationSec: video.duration_sec,
		resolutionWidth: video.resolution_width,
		resolutionHeight: video.resolution_height,
		fps: video.fps,
		codec: video.codec,
		recordedAt: video.recorded_at,
		sizeBytes: video.size_bytes,
		contributorUserId: video.contributor_user_id,
		contributorDisplayName: video.contributor_display_name,
		thumbnailUrl: resolveBackendUrl(video.thumbnail_url),
		processingProgress: normalizeProcessingProgress(video.processing_progress),
		dashboardVideoUrl: resolveBackendUrl(video.dashboard_video_url ?? null),
		sceneSummary: video.scene_summary,
		clipSegments: video.clip_segments,
		semanticMetadata: normalizeSemanticMetadata(video.semantic_metadata),
		createdAt: video.created_at,
	};
}

export async function requestVideos(
	repositoryId: string,
	filters: VideoListFilters,
) {
	const response = await apiClient.get<VideoListApiResponse>(
		repositoryVideosPath(repositoryId),
		{
			params: {
				page: filters.page ?? DEFAULT_VIDEO_PAGE,
				limit: filters.limit ?? DEFAULT_VIDEO_LIMIT,
				status:
					filters.status && filters.status !== VideoStatusFilter.All
						? filters.status
						: undefined,
				sort_by: filters.sortBy ?? DEFAULT_VIDEO_SORT_BY,
				sort_order: filters.sortOrder ?? DEFAULT_VIDEO_SORT_ORDER,
				contributor_user_id: filters.contributorUserId?.trim() || undefined,
			},
		},
	);

	return {
		total: response.data.total,
		page: response.data.page,
		limit: response.data.limit,
		contributors: response.data.contributors.map((contributor) => ({
			userId: contributor.user_id,
			displayName: contributor.display_name,
			videoCount: contributor.video_count,
			latestRecordedAt: contributor.latest_recorded_at,
		})),
		data: response.data.data.map(normalizeVideo),
	} satisfies VideoListResponse;
}

export async function requestVideoStatus(
	repositoryId: string,
	videoId: string,
) {
	const response = await apiClient.get<{
		id: string;
		repository_id: string;
		status: VideoStatus;
		progress: VideoProcessingProgressApiRecord | null;
		error_message: string | null;
		processing_started_at: string | null;
		processing_completed_at: string | null;
	}>(repositoryVideoStatusPath(repositoryId, videoId));

	return {
		id: response.data.id,
		repositoryId: response.data.repository_id,
		status: response.data.status,
		progress: normalizeProcessingProgress(response.data.progress),
		errorMessage: response.data.error_message,
		processingStartedAt: response.data.processing_started_at,
		processingCompletedAt: response.data.processing_completed_at,
	} satisfies VideoStatusResponse;
}

export async function requestVideoDetail(
	repositoryId: string,
	videoId: string,
) {
	const response = await apiClient.get<RepositoryVideoApiRecord>(
		repositoryVideoPath(repositoryId, videoId),
	);
	return normalizeVideo(response.data);
}

export async function requestDeleteVideo(
	repositoryId: string,
	videoId: string,
) {
	const response = await apiClient.delete<{ id: string; deleted: boolean }>(
		repositoryVideoPath(repositoryId, videoId),
	);

	return response.data;
}

export async function requestVideoDownload(
	repositoryId: string,
	videoId: string,
	repositoryName?: string | null,
) {
	const response = await apiClient.get<Blob>(
		repositoryVideoDownloadPath(repositoryId, videoId),
		{
			responseType: "blob",
		},
	);

	const extension = inferExtension(response.headers["content-type"]);
	const fallbackFileName = `${sanitizeFilenamePart(repositoryName)}-${videoId}.${extension}`;
	const fileName = ensureFilenameExtension(
		getFilenameFromContentDisposition(
			response.headers["content-disposition"],
		) ??
			getFilenameFromResponseUrl(response.request) ??
			fallbackFileName,
		extension,
	);

	return {
		blob: response.data,
		fileName,
	} satisfies VideoDownloadResponse;
}
