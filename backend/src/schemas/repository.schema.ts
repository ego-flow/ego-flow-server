import { RepoRole, RepoVisibility } from "@prisma/client";
import { z } from "zod";

const repositoryNameSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9_-]+$/);
const userIdSchema = z.string().trim().min(1).max(64).regex(/^[a-z0-9_]+$/);
const repositoryTagSchema = z
  .string()
  .trim()
  .transform((tag) => tag.replace(/^#+/, "").trim())
  .refine((tag) => tag.length > 0, { message: "Repository tags cannot be empty." })
  .refine((tag) => tag.length <= 40, { message: "Repository tags must be at most 40 characters." });
const repositoryTagsSchema = z
  .array(repositoryTagSchema)
  .max(20)
  .transform((tags) => {
    const uniqueTags = new Map<string, string>();
    for (const tag of tags) {
      const key = tag.toLowerCase();
      if (!uniqueTags.has(key)) {
        uniqueTags.set(key, tag);
      }
    }
    return Array.from(uniqueTags.values());
  });

export const repositoryIdParamSchema = z.object({
  repoId: z.uuid(),
});

export const repositoryMemberParamSchema = z.object({
  repoId: z.uuid(),
  userId: userIdSchema,
});

export const repositoryResolveQuerySchema = z
  .object({
    slug: z.string().trim().min(1).optional(),
    owner_id: userIdSchema.optional(),
    name: repositoryNameSchema.optional(),
  })
  .refine((value) => Boolean(value.slug) || Boolean(value.owner_id && value.name), {
    message: "Either 'slug' or both 'owner_id' and 'name' are required.",
  });

export const createRepositorySchema = z.object({
  name: repositoryNameSchema,
  visibility: z.nativeEnum(RepoVisibility).default(RepoVisibility.private),
  description: z.string().trim().max(500).optional(),
  tags: repositoryTagsSchema.optional(),
});

export const updateRepositorySchema = z
  .object({
    name: repositoryNameSchema.optional(),
    visibility: z.nativeEnum(RepoVisibility).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    tags: repositoryTagsSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.visibility !== undefined || value.description !== undefined || value.tags !== undefined, {
    message: "At least one field must be provided.",
  });

export const manifestQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
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
export type RepositoryResolveQueryInput = z.infer<typeof repositoryResolveQuerySchema>;
export type CreateRepositoryInput = z.infer<typeof createRepositorySchema>;
export type UpdateRepositoryInput = z.infer<typeof updateRepositorySchema>;
export type ManifestQueryInput = z.infer<typeof manifestQuerySchema>;
export type CreateRepositoryMemberInput = z.infer<typeof createRepositoryMemberSchema>;
export type UpdateRepositoryMemberInput = z.infer<typeof updateRepositoryMemberSchema>;
