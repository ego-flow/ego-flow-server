import assert from "node:assert/strict";
import { after, beforeEach, test } from "node:test";

import { RepoRole, RepoVisibility } from "@prisma/client";
import type { RepositoryResolveRow } from "../src/repositories/repositories.repository";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

(globalThis as any).__egoflowPrisma = {} as any;

const { AppError } = require("../src/lib/errors") as typeof import("../src/lib/errors");
const { getRepositoryAccessPolicy } =
  require("../src/lib/repository-access-policy") as typeof import("../src/lib/repository-access-policy");
const { repoMemberRepository } =
  require("../src/repositories/repo-member.repository") as typeof import("../src/repositories/repo-member.repository");
const { repositoriesRepository } =
  require("../src/repositories/repositories.repository") as typeof import("../src/repositories/repositories.repository");
const { repositoryAccessService } =
  require("../src/services/repository-access.service") as typeof import("../src/services/repository-access.service");

const repository: RepositoryResolveRow = {
  id: "repo-1",
  name: "daily-kitchen",
  ownerId: "alice",
  visibility: RepoVisibility.public,
  description: null,
  tags: [],
  deactivated: false,
  createdAt: new Date("2026-04-01T00:00:00.000Z"),
  updatedAt: new Date("2026-04-12T00:00:00.000Z"),
};

const originalFindRepositoryById = repositoriesRepository.findRepositoryById;
const originalFindRepositoryState = repositoriesRepository.findRepositoryState;
const originalFindMembershipRole = repoMemberRepository.findMembershipRole;

const isForbidden = (error: unknown) =>
  error instanceof AppError && error.statusCode === 403 && error.code === "FORBIDDEN";

beforeEach(() => {
  repositoriesRepository.findRepositoryById = async () => repository;
  repositoriesRepository.findRepositoryState = async () => ({
    id: repository.id,
    deactivated: repository.deactivated,
  });
  repoMemberRepository.findMembershipRole = async () => null;
});

after(() => {
  repositoriesRepository.findRepositoryById = originalFindRepositoryById;
  repositoriesRepository.findRepositoryState = originalFindRepositoryState;
  repoMemberRepository.findMembershipRole = originalFindMembershipRole;
});

test("read actions allow public repository access without membership", async () => {
  const access = await repositoryAccessService.assertAction("viewer", "user", repository.id, "video.download");

  assert.equal(access.repository.id, repository.id);
  assert.equal(access.effectiveRole, "read");
  assert.equal(access.isSystemAdmin, false);
});

test("maintain actions do not use public read fallback", async () => {
  await assert.rejects(
    () => repositoryAccessService.assertAction("viewer", "user", repository.id, "stream.record"),
    isForbidden,
  );

  await assert.rejects(
    () => repositoryAccessService.assertAction("viewer", "user", repository.id, "video.delete"),
    isForbidden,
  );
});

test("admin actions do not use public read fallback", async () => {
  await assert.rejects(
    () => repositoryAccessService.assertAction("viewer", "user", repository.id, "repository.updateSettings"),
    isForbidden,
  );
});

test("maintain membership grants maintain actions on public repositories", async () => {
  repoMemberRepository.findMembershipRole = async () => RepoRole.maintain;

  const access = await repositoryAccessService.assertAction("maintainer", "user", repository.id, "video.delete");

  assert.equal(access.repository.id, repository.id);
  assert.equal(access.effectiveRole, "maintain");
});

test("repository.delete is a role-only policy and requires admin action access", async () => {
  assert.deepEqual(getRepositoryAccessPolicy("repository.delete"), {
    minRole: "admin",
  });

  await assert.rejects(
    () => repositoryAccessService.assertAction("viewer", "user", repository.id, "repository.delete"),
    isForbidden,
  );

  repoMemberRepository.findMembershipRole = async () => RepoRole.admin;

  const access = await repositoryAccessService.assertAction(
    "repo-admin",
    "user",
    repository.id,
    "repository.delete",
  );

  assert.equal(access.repository.id, repository.id);
  assert.equal(access.effectiveRole, "admin");
  assert.equal(access.isSystemAdmin, false);
});

test("system admins can execute repository.delete without membership", async () => {
  const access = await repositoryAccessService.assertAction(
    "system-admin",
    "admin",
    repository.id,
    "repository.delete",
  );

  assert.equal(access.repository.id, repository.id);
  assert.equal(access.effectiveRole, "admin");
  assert.equal(access.isSystemAdmin, true);
});

test("repository status checks are separate from action access", async () => {
  await repositoryAccessService.assertRepositoryStatus(repository.id, "active");

  repositoriesRepository.findRepositoryState = async () => ({
    id: repository.id,
    deactivated: true,
  });

  await assert.rejects(
    () => repositoryAccessService.assertRepositoryStatus(repository.id, "active"),
    (error: any) => error?.statusCode === 404 && error?.code === "NOT_FOUND",
  );
  await repositoryAccessService.assertRepositoryStatus(repository.id, "deactivated");
});
