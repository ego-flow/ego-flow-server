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
