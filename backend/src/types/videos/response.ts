import type { VideoSemanticMetadataStatus, VideoStatus } from "@prisma/client";

import type { RecordingFinalizeProgress } from "../processing";

export interface RepositoryContributorResponse {
  user_id: string;
  display_name: string;
  video_count: number;
  latest_recorded_at: string | null;
}

export interface RepositoryVideoSemanticMetadataResponse {
  video_id: string;
  status: VideoSemanticMetadataStatus;
  clip_segments: unknown;
  action_labels: unknown;
  video_text_alignment: unknown;
  scene_summary: string | null;
  error_message: string | null;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RepositoryVideoResponse {
  id: string;
  repository_id: string;
  repository_name: string;
  owner_id: string;
  status: VideoStatus;
  duration_sec: number | null;
  resolution_width: number | null;
  resolution_height: number | null;
  fps: number | null;
  codec: string | null;
  recorded_at: string | null;
  size_bytes: number | null;
  contributor_user_id: string | null;
  contributor_display_name: string | null;
  thumbnail_url: string | null;
  processing_progress: RecordingFinalizeProgress | null;
  dashboard_video_url?: string | null;
  scene_summary: string | null;
  clip_segments: unknown;
  semantic_metadata: RepositoryVideoSemanticMetadataResponse | null;
  created_at: string;
}

export interface RepositoryVideoListResponse {
  total: number;
  page: number;
  limit: number;
  contributors: RepositoryContributorResponse[];
  data: RepositoryVideoResponse[];
}

export interface RepositoryVideoStatusResponse {
  id: string;
  repository_id: string;
  status: VideoStatus;
  progress: RecordingFinalizeProgress | null;
  error_message: string | null;
  processing_started_at: string | null;
  processing_completed_at: string | null;
}

export interface RepositoryVideoSignedFileResponse {
  redirectUrl: string;
}

export interface RepositoryVideoDownloadResponse extends RepositoryVideoSignedFileResponse {
  id: string;
  path: string;
  sizeBytes: bigint | number | null;
  sha256: string | null;
}
