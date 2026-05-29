ALTER TABLE "repositories"
ADD COLUMN "contributor_user_ids" JSONB NOT NULL DEFAULT '[]'::jsonb,
ADD COLUMN "video_contributor_user_ids" JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE "videos"
ADD COLUMN "size_bytes" BIGINT,
ADD COLUMN "recorder_user_id" VARCHAR(64);

UPDATE "videos" AS v
SET
  "size_bytes" = COALESCE(v."size_bytes", v."vlm_size_bytes"),
  "recorder_user_id" = COALESCE(v."recorder_user_id", rs."user_id")
FROM "recording_sessions" AS rs
WHERE v."recording_session_id" = rs."id";

UPDATE "repositories" AS r
SET "video_contributor_user_ids" = COALESCE(contributors.user_ids, '[]'::jsonb)
FROM (
  SELECT
    uploaded."repository_id",
    jsonb_agg(uploaded."user_id" ORDER BY uploaded."user_id") AS user_ids
  FROM (
    SELECT DISTINCT v."repository_id", v."recorder_user_id" AS "user_id"
    FROM "videos" AS v
    WHERE v."recorder_user_id" IS NOT NULL
  ) AS uploaded
  GROUP BY uploaded."repository_id"
) AS contributors
WHERE contributors."repository_id" = r."id";

UPDATE "repositories" AS r
SET "contributor_user_ids" = COALESCE(contributors.user_ids, '[]'::jsonb)
FROM (
  SELECT
    repo_ids."repository_id",
    jsonb_agg(repo_ids."user_id" ORDER BY repo_ids."user_id") AS user_ids
  FROM (
    SELECT rm."repository_id", rm."user_id"
    FROM "repo_members" AS rm
    WHERE rm."role" = 'admin'

    UNION

    SELECT rm."repository_id", rm."user_id"
    FROM "repo_members" AS rm
    WHERE rm."role" = 'maintain'
      AND rm."user_id" IN (
        SELECT jsonb_array_elements_text(r2."video_contributor_user_ids")
        FROM "repositories" AS r2
        WHERE r2."id" = rm."repository_id"
      )
  ) AS repo_ids
  GROUP BY repo_ids."repository_id"
) AS contributors
WHERE contributors."repository_id" = r."id";

CREATE INDEX "idx_videos_recorder_user_id" ON "videos"("recorder_user_id");
