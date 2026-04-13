import { VideoStatus } from "@prisma/client";
import { z } from "zod";

export const repoVideoSortBySchema = z.enum(["created_at", "recorded_at", "duration_sec"]);

export const repoVideoRepositoryParamSchema = z.object({
  repoId: z.uuid(),
});

export const repoVideoParamsSchema = z.object({
  repoId: z.uuid(),
  videoId: z.uuid(),
});

export const repoVideoListQuerySchema = z.object({
  status: z.nativeEnum(VideoStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort_by: repoVideoSortBySchema.default("created_at"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

export type RepoVideoRepositoryParamInput = z.infer<typeof repoVideoRepositoryParamSchema>;
export type RepoVideoParamsInput = z.infer<typeof repoVideoParamsSchema>;
export type RepoVideoListQueryInput = z.infer<typeof repoVideoListQuerySchema>;
