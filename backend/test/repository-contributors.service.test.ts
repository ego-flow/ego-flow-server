import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { RepoRole } from "@prisma/client";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

let updatedContributors: unknown = null;
let updatedVideoContributors: unknown = null;

const fakePrisma: any = {
  repoMember: {
    findMany: async () => [
      { userId: "alice", role: RepoRole.admin },
      { userId: "bob", role: RepoRole.maintain },
      { userId: "carol", role: RepoRole.maintain },
    ],
  },
  video: {
    findMany: async () => [{ recorder: "bob" }],
  },
  repository: {
    findUnique: async () => ({
      contributors: [],
      videoContributors: [],
    }),
    update: async ({ data }: { data: { contributors: unknown; videoContributors: unknown } }) => {
      updatedContributors = data.contributors;
      updatedVideoContributors = data.videoContributors;
      return null;
    },
  },
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const { computeRepositoryContributorUserIds, refreshRepositoryContributors } =
  require("../src/services/repository-contributors.service") as typeof import("../src/services/repository-contributors.service");

beforeEach(() => {
  updatedContributors = null;
  updatedVideoContributors = null;
  fakePrisma.repoMember.findMany = async () => [
    { userId: "alice", role: RepoRole.admin },
    { userId: "bob", role: RepoRole.maintain },
    { userId: "carol", role: RepoRole.maintain },
  ];
  fakePrisma.video.findMany = async () => [{ recorder: "bob" }];
  fakePrisma.repository.findUnique = async () => ({
    contributors: [],
    videoContributors: [],
  });
});

test("repository contributors include admins and maintainers with uploaded videos", async () => {
  const contributors = await computeRepositoryContributorUserIds("repo-1");

  assert.deepEqual(contributors, ["alice", "bob"]);

  await refreshRepositoryContributors("repo-1");
  assert.deepEqual(updatedContributors, ["alice", "bob"]);
  assert.deepEqual(updatedVideoContributors, ["bob"]);
});

test("repository contributors keep uploaded maintainers even after uploaded videos are removed", async () => {
  fakePrisma.repository.findUnique = async () => ({
    contributors: [],
    videoContributors: ["carol"],
  });
  fakePrisma.video.findMany = async () => [];

  const contributors = await computeRepositoryContributorUserIds("repo-1");

  assert.deepEqual(contributors, ["alice", "carol"]);
});

test("repository contributors drop admin-default contributors when demoted without uploads", async () => {
  fakePrisma.repository.findUnique = async () => ({
    contributors: ["dave"],
    videoContributors: [],
  });
  fakePrisma.repoMember.findMany = async () => [
    { userId: "alice", role: RepoRole.admin },
    { userId: "dave", role: RepoRole.maintain },
  ];
  fakePrisma.video.findMany = async () => [];

  const contributors = await computeRepositoryContributorUserIds("repo-1");

  assert.deepEqual(contributors, ["alice"]);
});
