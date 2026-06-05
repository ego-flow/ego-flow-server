import type { Prisma, RepoVisibility } from "@prisma/client";

import type { RepositoryRecord } from "../types/repository";

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
