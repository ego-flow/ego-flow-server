import type { z } from "zod";

import type {
  createRepositoryMemberSchema,
  createRepositorySchema,
  manifestQuerySchema,
  repositoryIdParamSchema,
  repositoryMemberParamSchema,
  repositoryResolveQuerySchema,
  updateRepositoryMemberSchema,
  updateRepositorySchema,
} from "../../schemas/repository.schema";

export type RepositoryIdParamInput = z.infer<typeof repositoryIdParamSchema>;
export type RepositoryMemberParamInput = z.infer<typeof repositoryMemberParamSchema>;
export type RepositoryResolveQueryInput = z.infer<typeof repositoryResolveQuerySchema>;
export type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;
export type UpdateRepositoryInput = z.infer<typeof updateRepositorySchema>;
export type ManifestQueryInput = z.infer<typeof manifestQuerySchema>;
export type CreateRepositoryMemberInput = z.infer<typeof createRepositoryMemberSchema>;
export type UpdateRepositoryMemberInput = z.infer<typeof updateRepositoryMemberSchema>;
