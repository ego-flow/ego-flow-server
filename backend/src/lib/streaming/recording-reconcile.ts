import {
  RecordingSessionEndReason,
  RecordingSessionIngestType,
  RecordingSessionStatus,
} from "@prisma/client";

import { runtimeConfig as env } from "../../config/runtime";
import { recordingSessionRepository } from "../../repositories/recording-session.repository";
import { clearLivePointers } from "./stream-live-cache";
import {
  extractRepositoryNameFromStreamPath,
  normalizeStreamPath,
} from "./stream-paths";
import { tryEnqueueRecordingFinalize } from "./recording-finalize";

type StreamingSessionForClose = {
  id: string;
  repositoryId: string;
  streamPath: string;
  status: RecordingSessionStatus;
  endReason: RecordingSessionEndReason | null;
  closedAt?: Date | null;
};

const closeStreamingSession = async (
  session: StreamingSessionForClose,
  options: {
    endReason: RecordingSessionEndReason;
    logPrefix: string;
    [key: string]: unknown;
  },
): Promise<void> => {
  const closedAt = session.closedAt ?? new Date();
  await recordingSessionRepository.close({
    recordingSessionId: session.id,
    closedAt,
    endReason: session.endReason ?? options.endReason,
  });

  const repoName = extractRepositoryNameFromStreamPath(session.streamPath);
  await clearLivePointers(session.id, session.repositoryId, repoName);

  const { logPrefix, endReason: _endReason, ...details } = options;
  console.info(logPrefix, {
    recordingSessionId: session.id,
    repositoryId: session.repositoryId,
    repositoryName: repoName,
    previousStatus: session.status,
    ...details,
  });
};

export type RecordingReconcileOptions = {
  getActiveStreamPaths?: () => Promise<Set<string> | null>;
  tryEnqueueFinalize?: (recordingSessionId: string) => Promise<boolean>;
};

export const getMediamtxActiveStreamPaths = async (): Promise<Set<string> | null> => {
  const baseUrl = env.MEDIAMTX_API_URL.replace(/\/+$/, "");

  try {
    const response = await fetch(`${baseUrl}/v3/paths/list`);
    if (!response.ok) {
      console.warn("[rtmp-reconcile] active-path-query-failed", {
        reason: `status ${response.status}`,
      });
      return null;
    }

    const payload = (await response.json()) as { items?: Array<{ name?: unknown }> };
    const paths = new Set<string>();

    for (const item of payload.items ?? []) {
      if (typeof item.name !== "string") {
        continue;
      }
      const normalized = normalizeStreamPath(item.name);
      const parts = normalized.split("/");
      if (parts.length >= 3 && parts[0] === "live" && parts[1] && parts[2]) {
        paths.add(normalized);
      }
    }

    return paths;
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.warn("[rtmp-reconcile] active-path-query-failed", {
      reason: message,
    });
    return null;
  }
};

export const reconcileMediamtxRecordingSessions = async (
  options: RecordingReconcileOptions = {},
): Promise<void> => {
  const mediamtxSessions = await recordingSessionRepository.findStreamingByIngestType(
    RecordingSessionIngestType.MEDIAMTX,
  );
  const getActiveStreamPaths = options.getActiveStreamPaths ?? getMediamtxActiveStreamPaths;
  const tryEnqueueFinalize = options.tryEnqueueFinalize ?? tryEnqueueRecordingFinalize;
  const activeStreamPaths = mediamtxSessions.length > 0 ? await getActiveStreamPaths() : null;

  for (const session of mediamtxSessions) {
    const repoName = extractRepositoryNameFromStreamPath(session.streamPath);

    if (session.closedAt) {
      await closeStreamingSession(session, {
        endReason: session.endReason ?? RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
        logPrefix: "[rtmp-reconcile] not-ready-streaming-closed",
      });
      await tryEnqueueFinalize(session.id);
      continue;
    }

    const activePathMissing = activeStreamPaths ? !activeStreamPaths.has(normalizeStreamPath(session.streamPath)) : false;
    if (activePathMissing) {
      await closeStreamingSession(session, {
        endReason: session.endReason ?? RecordingSessionEndReason.UNEXPECTED_DISCONNECT,
        logPrefix: "[rtmp-reconcile] missing-active-path-closed",
        repositoryName: repoName,
        activeStreamPaths: activeStreamPaths ? Array.from(activeStreamPaths.values()) : null,
      });
      await tryEnqueueFinalize(session.id);
    }
  }
};
