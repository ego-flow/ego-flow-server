import {
  RecordingSessionEndReason,
  RecordingSessionStatus,
} from "@prisma/client";

import { BadRequest, Conflict, Forbidden, NotFound } from "../lib/errors";
import { extractRepositoryNameFromStreamPath } from "../lib/stream-paths";
import { recordingSessionRepository } from "../repositories/recording-session.repository";
import type { RecordingCloseIntentInput } from "../schemas/stream.schema";

export class RecordingsService {
  async recordCloseIntent(
    recordingSessionId: string,
    requestUserId: string,
    input: RecordingCloseIntentInput,
  ) {
    if (input.reason !== RecordingSessionEndReason.NORMAL_DISCONNECT) {
      throw BadRequest("Unsupported close intent reason.");
    }

    const session = await recordingSessionRepository.findById(recordingSessionId);
    if (!session) {
      throw NotFound("Recording session not found.");
    }
    if (session.userId !== requestUserId) {
      throw Forbidden("Only the recording session owner can close this recording session.");
    }
    if (session.status !== RecordingSessionStatus.STREAMING) {
      throw Conflict(`Recording session is not in STREAMING state (current: ${session.status}).`);
    }

    const updated = await recordingSessionRepository.recordCloseIntent(
      recordingSessionId,
      RecordingSessionEndReason.NORMAL_DISCONNECT,
    );

    console.info("[rtmp-state] close-intent-recorded", {
      recordingSessionId,
      repositoryId: updated.repositoryId,
      repositoryName: extractRepositoryNameFromStreamPath(updated.streamPath),
      userId: updated.userId,
      reason: updated.endReason,
    });

    return updated;
  }
}

export const recordingsService = new RecordingsService();
