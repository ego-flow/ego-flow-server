UPDATE "repositories" AS r
SET "contributors" = COALESCE(merged.user_ids, '[]'::jsonb)
FROM (
  SELECT
    r2."id",
    jsonb_agg(users.user_id ORDER BY users.user_id) AS user_ids
  FROM "repositories" AS r2
  CROSS JOIN LATERAL (
    SELECT DISTINCT user_id
    FROM jsonb_array_elements_text(
      COALESCE(r2."contributors", '[]'::jsonb) || COALESCE(r2."videoContributors", '[]'::jsonb)
    ) AS contributor_values(user_id)
  ) AS users
  GROUP BY r2."id"
) AS merged
WHERE merged."id" = r."id";

ALTER TABLE "repositories"
DROP COLUMN "videoContributors";
