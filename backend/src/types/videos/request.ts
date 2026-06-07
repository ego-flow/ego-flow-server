import type { z } from "zod";

import type {
  repoVideoListQuerySchema,
  repoVideoParamsSchema,
  repoVideoRepositoryParamSchema,
} from "../../schemas/repository-video.schema";

export type RepoVideoRepositoryParamInput = z.infer<typeof repoVideoRepositoryParamSchema>;
export type RepoVideoParamsInput = z.infer<typeof repoVideoParamsSchema>;
export type RepoVideoListQueryInput = z.infer<typeof repoVideoListQuerySchema>;

export type RepoVideoOrderQuery = Pick<RepoVideoListQueryInput, "sort_by" | "sort_order">;
