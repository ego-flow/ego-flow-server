import { BadRequest } from "./errors";

export function normalizeStreamPath(streamPath: string): string {
  return streamPath.trim().replace(/^\/+|\/+$/g, "");
}

/**
 * "live/{repoName}/{recordingSessionId}" 형식의 stream path에서 repository 이름을 추출한다.
 */
export function extractRepositoryNameFromStreamPath(streamPath: string): string {
  const normalized = normalizeStreamPath(streamPath);
  const parts = normalized.split("/");
  if (parts.length < 2 || parts[0] !== "live" || !parts[1]) {
    throw BadRequest("Invalid stream path format.");
  }
  return parts[1];
}

export function extractRecordingSessionIdFromStreamPath(streamPath: string): string | null {
  const normalized = normalizeStreamPath(streamPath);
  const parts = normalized.split("/");
  if (parts.length < 3 || parts[0] !== "live" || !parts[2]) {
    return null;
  }
  return parts[2];
}
