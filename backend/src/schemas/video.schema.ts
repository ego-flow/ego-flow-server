import { VideoStatus } from "@prisma/client";
import { z } from "zod";

export const videoSortBySchema = z.enum(["created_at", "recorded_at", "duration_sec"]);

export const videoIdParamSchema = z.object({
  videoId: z.uuid(),
});

export const videoListQuerySchema = z.object({
  repository_id: z.uuid().optional(),
  status: z.nativeEnum(VideoStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort_by: videoSortBySchema.default("created_at"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

export type VideoListQueryInput = z.infer<typeof videoListQuerySchema>;
export type VideoIdParamInput = z.infer<typeof videoIdParamSchema>;
export type VideoSortBy = z.infer<typeof videoSortBySchema>;
