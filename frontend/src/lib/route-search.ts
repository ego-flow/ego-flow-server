import type { SortOrder, VideoSortBy, VideoStatus } from '#/api/videos'

export const defaultRepositoriesSearch = {
  repositoryId: '',
}

export const defaultRepositoryVideosSearch: {
  page: number
  limit: number
  status: VideoStatus | 'ALL'
  sortBy: VideoSortBy
  sortOrder: SortOrder
} = {
  page: 1,
  limit: 20,
  status: 'ALL',
  sortBy: 'recorded_at',
  sortOrder: 'desc',
}
