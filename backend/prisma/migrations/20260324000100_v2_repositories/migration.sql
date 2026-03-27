-- CreateEnum
CREATE TYPE "RepoVisibility" AS ENUM ('public', 'private');

-- CreateEnum
CREATE TYPE "RepoRole" AS ENUM ('read', 'maintain', 'admin');

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "owner_id" VARCHAR(64) NOT NULL,
    "visibility" "RepoVisibility" NOT NULL DEFAULT 'public',
    "description" VARCHAR(500),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repo_members" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "role" "RepoRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repo_members_pkey" PRIMARY KEY ("id")
);

-- DropForeignKey
ALTER TABLE "videos" DROP CONSTRAINT "videos_user_id_fkey";

-- DropIndex
DROP INDEX "idx_videos_video_key";

-- DropIndex
DROP INDEX "idx_videos_user_id";

-- AlterTable
ALTER TABLE "videos"
ADD COLUMN "repository_id" UUID NOT NULL,
DROP COLUMN "video_key",
DROP COLUMN "user_id";

-- CreateIndex
CREATE UNIQUE INDEX "repositories_owner_id_name_key" ON "repositories"("owner_id", "name");

-- CreateIndex
CREATE INDEX "idx_repos_owner_id" ON "repositories"("owner_id");

-- CreateIndex
CREATE INDEX "idx_repos_visibility" ON "repositories"("visibility");

-- CreateIndex
CREATE UNIQUE INDEX "repo_members_repository_id_user_id_key" ON "repo_members"("repository_id", "user_id");

-- CreateIndex
CREATE INDEX "idx_repo_members_repo_id" ON "repo_members"("repository_id");

-- CreateIndex
CREATE INDEX "idx_repo_members_user_id" ON "repo_members"("user_id");

-- CreateIndex
CREATE INDEX "idx_videos_repository_id" ON "videos"("repository_id");
