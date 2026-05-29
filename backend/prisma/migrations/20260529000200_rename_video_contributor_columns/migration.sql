ALTER TABLE "repositories"
RENAME COLUMN "contributor_user_ids" TO "contributors";

ALTER TABLE "repositories"
RENAME COLUMN "video_contributor_user_ids" TO "videoContributors";

ALTER TABLE "videos"
RENAME COLUMN "size_bytes" TO "sizeBytes";

ALTER TABLE "videos"
RENAME COLUMN "recorder_user_id" TO "recorder";

ALTER INDEX IF EXISTS "idx_videos_recorder_user_id" RENAME TO "idx_videos_recorder";
