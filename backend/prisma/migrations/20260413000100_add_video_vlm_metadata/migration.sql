-- AlterTable
ALTER TABLE "videos"
ADD COLUMN "vlm_size_bytes" BIGINT,
ADD COLUMN "vlm_sha256" VARCHAR(64);
