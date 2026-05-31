export enum SortOrder {
	Asc = "asc",
	Desc = "desc",
}

export enum VideoSortBy {
	DurationSec = "duration_sec",
	RecordedAt = "recorded_at",
	SizeBytes = "size_bytes",
}

export enum VideoStatus {
	Completed = "COMPLETED",
	Failed = "FAILED",
}

export enum VideoStatusFilter {
	All = "ALL",
}

export const DEFAULT_VIDEO_PAGE = 1;
export const DEFAULT_VIDEO_LIMIT = 20;
export const MAX_VIDEO_LIMIT = 100;
export const DEFAULT_VIDEO_SORT_BY = VideoSortBy.RecordedAt;
export const DEFAULT_VIDEO_SORT_ORDER = SortOrder.Desc;
export const DEFAULT_VIDEO_EXTENSION = "mp4";
export const DEFAULT_VIDEO_FILENAME_BASE = "video";

export const CONTENT_TYPE_EXTENSION_MAP: Record<string, string> = {
	"video/mp4": "mp4",
	"video/webm": "webm",
	"video/quicktime": "mov",
	"video/x-matroska": "mkv",
};

export const FILENAME_EXTENSION_PATTERN = /\.[a-zA-Z0-9]+$/;
export const UNSAFE_FILENAME_CHARS_PATTERN = /[^a-zA-Z0-9._-]+/g;
export const TRIM_DASH_PATTERN = /^-+|-+$/g;
export const CONTENT_DISPOSITION_ENCODED_FILENAME_PATTERN =
	/filename\*\s*=\s*UTF-8''([^;]+)/i;
export const CONTENT_DISPOSITION_PLAIN_FILENAME_PATTERN =
	/filename\s*=\s*("?)([^";]+)\1/i;
