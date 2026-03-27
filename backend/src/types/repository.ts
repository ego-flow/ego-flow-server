export type AppRepoRole = "read" | "maintain" | "admin";

export interface RepositoryRecord {
  id: string;
  name: string;
  ownerId: string;
  visibility: "public" | "private";
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RepositoryAccessContext {
  repository: RepositoryRecord;
  effectiveRole: AppRepoRole;
  isSystemAdmin: boolean;
}
