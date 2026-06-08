import type { Prisma } from "@prisma/client";

import { videosRepository } from "../../repositories/videos.repository";
import type { RepoVideoListQueryInput, RepoVideoOrderQuery } from "../../types/videos/request";

export const buildRepositoryVideoOrderBy = (
  query: RepoVideoOrderQuery,
): Prisma.VideosOrderByWithRelationInput => {
  switch (query.sort_by) {
    case "recorded_at":
      return { recordedAt: query.sort_order };
    case "duration_sec":
      return { durationSec: query.sort_order };
    case "size_bytes":
      return { sizeBytes: query.sort_order };
    default:
      return { recordedAt: query.sort_order };
  }
};

export const buildRepositoryVideoWhere = (
  repositoryId: string,
  query: Pick<RepoVideoListQueryInput, "status" | "contributor_user_id">,
): Prisma.VideosWhereInput => ({
  repositoryId,
  ...(query.status ? { status: query.status } : {}),
  ...(query.contributor_user_id ? { recorder: query.contributor_user_id } : {}),
});

export const findRepositoryVideosPage = async (
  repositoryId: string,
  query: RepoVideoListQueryInput,
) => {
  const where = buildRepositoryVideoWhere(repositoryId, query);

  const [total, videos] = await Promise.all([
    videosRepository.countVideos(where),
    videosRepository.findVideos({
      where,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      orderBy: buildRepositoryVideoOrderBy(query),
    }),
  ]);

  return { total, videos };
};
