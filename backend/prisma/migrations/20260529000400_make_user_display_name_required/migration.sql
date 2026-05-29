UPDATE "users"
SET "display_name" = "id"
WHERE "display_name" IS NULL OR length(btrim("display_name")) = 0;

ALTER TABLE "users"
  ALTER COLUMN "display_name" SET NOT NULL;

ALTER TABLE "users"
  ADD CONSTRAINT "users_display_name_non_empty_check"
  CHECK (length(btrim("display_name")) > 0);
