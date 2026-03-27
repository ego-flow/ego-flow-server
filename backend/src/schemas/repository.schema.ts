import { RepoRole, RepoVisibility } from "@prisma/client";
import { z } from "zod";

const repositoryNameSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/);
const userIdSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9_]+$/);

export const repositoryIdParamSchema = z.object({
  repoId: z.uuid(),
});

export const repositoryMemberParamSchema = z.object({
  repoId: z.uuid(),
  userId: userIdSchema,
});

export const createRepositorySchema = z.object({
  name: repositoryNameSchema,
  visibility: z.nativeEnum(RepoVisibility).default(RepoVisibility.private),
  description: z.string().trim().max(500).optional(),
});

export const updateRepositorySchema = z
  .object({
    name: repositoryNameSchema.optional(),
    visibility: z.nativeEnum(RepoVisibility).optional(),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .refine((value) => value.name !== undefined || value.visibility !== undefined || value.description !== undefined, {
    message: "At least one field must be provided.",
  });

export const createRepositoryMemberSchema = z.object({
  user_id: userIdSchema,
  role: z.nativeEnum(RepoRole),
});

export const updateRepositoryMemberSchema = z.object({
  role: z.nativeEnum(RepoRole),
});

export type RepositoryIdParamInput = z.infer<typeof repositoryIdParamSchema>;
export type RepositoryMemberParamInput = z.infer<typeof repositoryMemberParamSchema>;
export type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;
export type UpdateRepositoryInput = z.infer<typeof updateRepositorySchema>;
export type CreateRepositoryMemberInput = z.infer<typeof createRepositoryMemberSchema>;
export type UpdateRepositoryMemberInput = z.infer<typeof updateRepositoryMemberSchema>;
