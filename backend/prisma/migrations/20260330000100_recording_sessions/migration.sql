-- CreateEnum
CREATE TYPE "RecordingSessionStatus" AS ENUM ('PENDING', 'STREAMING', 'STOP_REQUESTED', 'FINALIZING', 'COMPLETED', 'FAILED', 'ABORTED');

-- CreateEnum
CREATE TYPE "RecordingSessionEndReason" AS ENUM ('USER_STOP', 'GLASSES_STOP', 'UNEXPECTED_DISCONNECT', 'REGISTRATION_TIMEOUT', 'INTERNAL_ERROR');

-- CreateEnum
CREATE TYPE "RecordingSegmentStatus" AS ENUM ('WRITING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "videos" ADD COLUMN     "recording_session_id" UUID;

-- CreateTable
CREATE TABLE "recording_sessions" (
    "id" UUID NOT NULL,
    "repository_id" UUID NOT NULL,
    "owner_id" VARCHAR(64) NOT NULL,
    "user_id" VARCHAR(64) NOT NULL,
    "device_type" VARCHAR(100),
    "stream_path" VARCHAR(255) NOT NULL,
    "status" "RecordingSessionStatus" NOT NULL,
    "end_reason" "RecordingSessionEndReason",
    "target_directory" VARCHAR(1024) NOT NULL,
    "source_id" VARCHAR(255),
    "source_type" VARCHAR(50),
    "stop_requested_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "not_ready_at" TIMESTAMP(3),
    "finalized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recording_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recording_segments" (
    "id" UUID NOT NULL,
    "recording_session_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "raw_path" VARCHAR(1024) NOT NULL,
    "duration_sec" DOUBLE PRECISION,
    "status" "RecordingSegmentStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "recording_segments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_recording_sessions_repo_status" ON "recording_sessions"("repository_id", "status");

-- CreateIndex
CREATE INDEX "idx_recording_sessions_source_id" ON "recording_sessions"("source_id");

-- CreateIndex
CREATE INDEX "idx_recording_sessions_user_created_at" ON "recording_sessions"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_recording_segments_session_sequence" ON "recording_segments"("recording_session_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_recording_segments_session_raw_path" ON "recording_segments"("recording_session_id", "raw_path");

-- CreateIndex
CREATE UNIQUE INDEX "videos_recording_session_id_key" ON "videos"("recording_session_id");

-- CreateIndex
CREATE INDEX "idx_videos_recording_session_id" ON "videos"("recording_session_id");

-- AddForeignKey
ALTER TABLE "recording_segments" ADD CONSTRAINT "recording_segments_recording_session_id_fkey" FOREIGN KEY ("recording_session_id") REFERENCES "recording_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_recording_session_id_fkey" FOREIGN KEY ("recording_session_id") REFERENCES "recording_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
