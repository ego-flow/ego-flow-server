import type { RepositoryResolveQueryInput } from "../../types/repository/request";
import { BadRequest, ErrorCode } from "../core/errors";

export const normalizeRepositoryDescription = (description: string | null | undefined): string | null => {
  if (description === undefined || description === null) {
    return description ?? null;
  }

  const trimmed = description.trim();
  return trimmed ? trimmed : null;
};

export const getRepositoryResolveTarget = (query: RepositoryResolveQueryInput) => {
  if (query.slug) {
    const parts = query.slug.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw BadRequest("Slug must be in 'owner/name' format.", ErrorCode.INVALID_SLUG);
    }

    return {
      ownerId: parts[0],
      repoName: parts[1],
    };
  }

  return {
    ownerId: query.owner_id!,
    repoName: query.name!,
  };
};
