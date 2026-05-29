import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { RepoRole } from "@prisma/client";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

let updatedContributorUserIds: unknown = null;
let updatedVideoContributorUserIds: unknown = null;

const fakePrisma: any = {
  repoMember: {
    findMany: async () => [
      { userId: "alice", role: RepoRole.admin },
      { userId: "bob", role: RepoRole.maintain },
      { userId: "carol", role: RepoRole.maintain },
    ],
  },
  video: {
    findMany: async () => [{ recorderUserId: "bob" }],
  },
  repository: {
    findUnique: async () => ({
      contributorUserIds: [],
      videoContributorUserIds: [],
    }),
    update: async ({ data }: { data: { contributorUserIds: unknown; videoContributorUserIds: unknown } }) => {
      updatedContributorUserIds = data.contributorUserIds;
      updatedVideoContributorUserIds = data.videoContributorUserIds;
      return null;
    },
  },
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const { computeRepositoryContributorUserIds, refreshRepositoryContributors } =
  require("../src/services/repository-contributors.service") as typeof import("../src/services/repository-contributors.service");

beforeEach(() => {
  updatedContributorUserIds = null;
  updatedVideoContributorUserIds = null;
  fakePrisma.repoMember.findMany = async () => [
    { userId: "alice", role: RepoRole.admin },
    { userId: "bob", role: RepoRole.maintain },
    { userId: "carol", role: RepoRole.maintain },
  ];
  fakePrisma.video.findMany = async () => [{ recorderUserId: "bob" }];
  fakePrisma.repository.findUnique = async () => ({
    contributorUserIds: [],
    videoContributorUserIds: [],
  });
});

test("repository contributors include admins and maintainers with uploaded videos", async () => {
  const contributors = await computeRepositoryContributorUserIds("repo-1");

  assert.deepEqual(contributors, ["alice", "bob"]);

  await refreshRepositoryContributors("repo-1");
  assert.deepEqual(updatedContributorUserIds, ["alice", "bob"]);
  assert.deepEqual(updatedVideoContributorUserIds, ["bob"]);
});

test("repository contributors keep uploaded maintainers even after uploaded videos are removed", async () => {
  fakePrisma.repository.findUnique = async () => ({
    contributorUserIds: [],
    videoContributorUserIds: ["carol"],
  });
  fakePrisma.video.findMany = async () => [];

  const contributors = await computeRepositoryContributorUserIds("repo-1");

  assert.deepEqual(contributors, ["alice", "carol"]);
});

test("repository contributors drop admin-default contributors when demoted without uploads", async () => {
  fakePrisma.repository.findUnique = async () => ({
    contributorUserIds: ["dave"],
    videoContributorUserIds: [],
  });
  fakePrisma.repoMember.findMany = async () => [
    { userId: "alice", role: RepoRole.admin },
    { userId: "dave", role: RepoRole.maintain },
  ];
  fakePrisma.video.findMany = async () => [];

  const contributors = await computeRepositoryContributorUserIds("repo-1");

  assert.deepEqual(contributors, ["alice"]);
});
