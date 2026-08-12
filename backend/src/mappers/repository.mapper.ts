import type { Prisma, RepoVisibility } from "@prisma/client";

import type {
  AppRepoRole,
  RepositoryRecord,
  RepositoryResponse,
  RepositorySummaryResponse,
} from "../types/repository";

const toRepositoryVisibility = (visibility: RepoVisibility): "public" | "private" => visibility;

export const normalizeRepositoryTags = (tags: Prisma.JsonValue | string[] | null | undefined): string[] => {
  if (!Array.isArray(tags)) {
    return [];
  }

  const uniqueTags = new Map<string, string>();
  for (const tag of tags) {
    if (typeof tag !== "string") {
      continue;
    }

    const normalizedTag = tag.replace(/^#+/, "").trim();
    if (!normalizedTag) {
      continue;
    }

    const key = normalizedTag.toLowerCase();
    if (!uniqueTags.has(key)) {
      uniqueTags.set(key, normalizedTag);
    }
  }

  return Array.from(uniqueTags.values()).slice(0, 20);
};

export const toRepositoryRecord = (repository: {
  id: string;
  name: string;
  ownerId: string;
  visibility: RepoVisibility;
  description: string | null;
  tags?: Prisma.JsonValue | string[] | null;
  createdAt: Date;
  updatedAt: Date;
}): RepositoryRecord => ({
  id: repository.id,
  name: repository.name,
  ownerId: repository.ownerId,
  visibility: toRepositoryVisibility(repository.visibility),
  description: repository.description,
  tags: normalizeRepositoryTags(repository.tags),
  createdAt: repository.createdAt,
  updatedAt: repository.updatedAt,
});

export const toRepositoryResponse = (
  repository: RepositoryRecord,
  effectiveRole: AppRepoRole,
): RepositoryResponse => ({
  id: repository.id,
  name: repository.name,
  owner_id: repository.ownerId,
  visibility: repository.visibility,
  description: repository.description,
  tags: repository.tags,
  my_role: effectiveRole,
  created_at: repository.createdAt.toISOString(),
  updated_at: repository.updatedAt.toISOString(),
});

export const toRepositorySummary = (
  repository: RepositoryRecord,
  effectiveRole: AppRepoRole,
  videoCount: number,
): RepositorySummaryResponse => ({
  ...toRepositoryResponse(repository, effectiveRole),
  video_count: videoCount,
});
