-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'user');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" VARCHAR(64) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'user',
    "display_name" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" VARCHAR(255) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "videos" (
    "id" UUID NOT NULL,
    "video_key" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "raw_recording_path" VARCHAR(1024) NOT NULL,
    "stream_path" VARCHAR(255),
    "device_type" VARCHAR(100),
    "session_id" VARCHAR(255),
    "streamed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration_sec" DOUBLE PRECISION,
    "resolution_width" INTEGER,
    "resolution_height" INTEGER,
    "fps" DOUBLE PRECISION,
    "codec" VARCHAR(50),
    "recorded_at" TIMESTAMP(3),
    "vlm_video_path" VARCHAR(1024),
    "dashboard_video_path" VARCHAR(1024),
    "thumbnail_path" VARCHAR(1024),
    "clip_segments" JSONB,
    "action_labels" JSONB,
    "video_text_alignment" JSONB,
    "scene_summary" TEXT,
    "status" "VideoStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "processing_started_at" TIMESTAMP(3),
    "processing_completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "videos_status_idx" ON "videos"("status");

-- CreateIndex
CREATE INDEX "idx_videos_video_key" ON "videos"("video_key");

-- CreateIndex
CREATE INDEX "idx_videos_user_id" ON "videos"("user_id");

-- CreateIndex
CREATE INDEX "idx_videos_recorded_at" ON "videos"("recorded_at");

-- CreateIndex
CREATE INDEX "idx_videos_session" ON "videos"("session_id");

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
