import type { RepoRole } from "@prisma/client";

import type { AppRepoRole } from "../../types/repository";

const REPO_ROLE_RANK: Record<AppRepoRole, number> = {
  read: 1,
  maintain: 2,
  admin: 3,
};

export const toAppRepoRole = (role: RepoRole): AppRepoRole => role;

export const isRepoRoleAtLeast = (actualRole: AppRepoRole, minimumRole: AppRepoRole): boolean =>
  (REPO_ROLE_RANK[actualRole] ?? 0) >= (REPO_ROLE_RANK[minimumRole] ?? 0);
