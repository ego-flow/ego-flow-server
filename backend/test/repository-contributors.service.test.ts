import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { RepoRole } from "@prisma/client";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

let updatedContributors: unknown = null;
const lockCalls: string[] = [];

const fakePrisma: any = {
  repoMember: {
    findMany: async () => [
      { userId: "alice", role: RepoRole.admin },
    ],
  },
  video: {
    findMany: async () => [{ recorder: "bob" }],
  },
  repository: {
    findUnique: async () => ({
      contributors: [],
    }),
    update: async ({ data }: { data: { contributors: unknown } }) => {
      updatedContributors = data.contributors;
      return null;
    },
  },
  $queryRaw: async (...args: unknown[]) => {
    lockCalls.push(String(args[0]));
    return [{ id: "repo-1" }];
  },
};

(globalThis as any).__egoflowPrisma = fakePrisma;

const { computeRepositoryContributorUserIds, refreshRepositoryContributors } =
  require("../src/services/repository-contributors.service") as typeof import("../src/services/repository-contributors.service");

beforeEach(() => {
  updatedContributors = null;
  lockCalls.length = 0;
  fakePrisma.repoMember.findMany = async () => [
    { userId: "alice", role: RepoRole.admin },
  ];
  fakePrisma.video.findMany = async () => [{ recorder: "bob" }];
  fakePrisma.repository.findUnique = async () => ({
    contributors: [],
  });
});

test("repository contributors include existing contributors, admins, and recorders", async () => {
  fakePrisma.repository.findUnique = async () => ({
    contributors: ["carol"],
  });

  const contributors = await computeRepositoryContributorUserIds("repo-1");

  assert.deepEqual(contributors, ["alice", "bob", "carol"]);

  await refreshRepositoryContributors("repo-1");
  assert.deepEqual(updatedContributors, ["alice", "bob", "carol"]);
  assert.equal(lockCalls.length, 1);
});

test("repository contributors keep existing contributors after role changes and video removal", async () => {
  fakePrisma.repository.findUnique = async () => ({
    contributors: ["bob", "carol"],
  });
  fakePrisma.video.findMany = async () => [];
  fakePrisma.repoMember.findMany = async () => [{ userId: "alice", role: RepoRole.admin }];

  const contributors = await computeRepositoryContributorUserIds("repo-1");

  assert.deepEqual(contributors, ["alice", "bob", "carol"]);
});

test("repository contributors keep admin-default contributors after demotion", async () => {
  fakePrisma.repository.findUnique = async () => ({
    contributors: ["dave"],
  });
  fakePrisma.repoMember.findMany = async () => [{ userId: "alice", role: RepoRole.admin }];
  fakePrisma.video.findMany = async () => [];

  const contributors = await computeRepositoryContributorUserIds("repo-1");

  assert.deepEqual(contributors, ["alice", "dave"]);
});
