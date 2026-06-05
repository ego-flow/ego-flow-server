import type { AppRepoRole } from "../types/repository";

export type RepositoryAccessAction =
  | "repository.list"
  | "repository.listMaintained"
  | "repository.read"
  | "repository.updateSettings"
  | "repository.deactivate"
  | "repository.delete"
  | "repository.members.list"
  | "repository.members.add"
  | "repository.members.update"
  | "repository.members.delete"
  | "video.list"
  | "video.detail"
  | "video.status"
  | "video.manifest"
  | "video.download"
  | "video.delete"
  | "stream.record"
  | "live.list"
  | "live.detail"
  | "live.playbackTicket";

export type RepositoryStateMutationAction =
  | "repository.deactivate"
  | "repository.delete";

export type RepositoryActiveAccessAction = Exclude<
  RepositoryAccessAction,
  RepositoryStateMutationAction
>;

export type RepositoryAccessPolicy = {
  minRole: AppRepoRole;
};

export const REPOSITORY_ACCESS_POLICIES = {
  "repository.list": { minRole: "read" },
  "repository.listMaintained": { minRole: "maintain" },
  "repository.read": { minRole: "read" },
  "repository.updateSettings": { minRole: "admin" },
  "repository.deactivate": { minRole: "admin" },
  "repository.delete": { minRole: "admin" },
  "repository.members.list": { minRole: "admin" },
  "repository.members.add": { minRole: "admin" },
  "repository.members.update": { minRole: "admin" },
  "repository.members.delete": { minRole: "admin" },
  "video.list": { minRole: "read" },
  "video.detail": { minRole: "read" },
  "video.status": { minRole: "read" },
  "video.manifest": { minRole: "read" },
  "video.download": { minRole: "read" },
  "video.delete": { minRole: "maintain" },
  "stream.record": { minRole: "maintain" },
  "live.list": { minRole: "read" },
  "live.detail": { minRole: "read" },
  "live.playbackTicket": { minRole: "read" },
} satisfies Record<RepositoryAccessAction, RepositoryAccessPolicy>;

export const getRepositoryAccessPolicy = (action: RepositoryAccessAction): RepositoryAccessPolicy =>
  REPOSITORY_ACCESS_POLICIES[action];
