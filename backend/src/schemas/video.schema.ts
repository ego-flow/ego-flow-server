import { VideoStatus } from "@prisma/client";
import { z } from "zod";

export const videoSortBySchema = z.enum(["created_at", "recorded_at", "duration_sec"]);

export const videoIdParamSchema = z.object({
  videoId: z.uuid(),
});

export const videoListQuerySchema = z.object({
  video_key: z
    .string()
    .max(64)
    .regex(/^[a-z0-9_]+$/)
    .optional(),
  status: z.nativeEnum(VideoStatus).optional(),
  user_id: z.string().max(64).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sort_by: videoSortBySchema.default("created_at"),
  sort_order: z.enum(["asc", "desc"]).default("desc"),
});

export type VideoListQueryInput = z.infer<typeof videoListQuerySchema>;
export type VideoIdParamInput = z.infer<typeof videoIdParamSchema>;
export type VideoSortBy = z.infer<typeof videoSortBySchema>;
