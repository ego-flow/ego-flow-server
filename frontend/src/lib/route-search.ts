import {
	DEFAULT_VIDEO_LIMIT,
	DEFAULT_VIDEO_PAGE,
	DEFAULT_VIDEO_SORT_BY,
	DEFAULT_VIDEO_SORT_ORDER,
	type SortOrder,
	type VideoSortBy,
	type VideoStatus,
	VideoStatusFilter,
} from "#/constants/video/video-constants";

export const defaultRepositoriesSearch = {
	repositoryId: "",
};

export const defaultRepositoryVideosSearch: {
	page: number;
	limit: number;
	status: VideoStatus | VideoStatusFilter;
	sortBy: VideoSortBy;
	sortOrder: SortOrder;
	contributorUserId: string;
} = {
	page: DEFAULT_VIDEO_PAGE,
	limit: DEFAULT_VIDEO_LIMIT,
	status: VideoStatusFilter.All,
	sortBy: DEFAULT_VIDEO_SORT_BY,
	sortOrder: DEFAULT_VIDEO_SORT_ORDER,
	contributorUserId: "",
};
