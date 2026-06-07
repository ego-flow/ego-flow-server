import type { AppRepoRole, RepositoryRecord } from "./model";

export interface RepositoryResponse {
  id: string;
  name: string;
  owner_id: string;
  visibility: RepositoryRecord["visibility"];
  description: string | null;
  tags: string[];
  my_role: AppRepoRole;
  created_at: string;
  updated_at: string;
}

export interface RepositorySummaryResponse extends RepositoryResponse {
  video_count: number;
}

export interface RepositoryManifestResponse {
  manifest_version: "1";
  repository: {
    id: string;
    owner_id: string;
    name: string;
    visibility: RepositoryRecord["visibility"];
    my_role: AppRepoRole;
  };
  default_artifact: "vlm_video";
  pagination: {
    total: number;
    page: number;
    limit: number;
    has_next: boolean;
  };
  videos: RepositoryManifestVideoResponse[];
}

export interface RepositoryManifestVideoResponse {
  video_id: string;
  recorded_at: string | null;
  duration_sec: number | null;
  resolution_width: number | null;
  resolution_height: number | null;
  fps: number | null;
  codec: string | null;
  scene_summary: string | null;
  clip_segments: unknown | null;
  artifacts: {
    vlm_video: {
      download_url: string;
      size_bytes: number;
      sha256: string;
      content_type: "video/mp4";
    };
    thumbnail: {
      download_url: string;
      content_type: "image/jpeg";
    } | null;
  };
}

export interface RepositoryDeleteReadinessResponse {
  repository_id: string;
  can_delete: boolean;
  checks: {
    is_deactivated: true;
    active_streaming_session_count: number;
    finalizing_segment_count: number;
  };
}

export interface RepositoryDeactivateResponse {
  id: string;
  deactivated: true;
}

export interface RepositoryPermanentDeleteResponse {
  id: string;
  deleted: true;
}
