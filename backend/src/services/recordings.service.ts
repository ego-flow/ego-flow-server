import { recordRecordingCloseIntent } from "../lib/streaming/recording-close-intent";
import type { RecordingCloseIntentInput } from "../types/stream/request";

export class RecordingsService {
  async recordCloseIntent(
    recordingSessionId: string,
    requestUserId: string,
    input: RecordingCloseIntentInput,
  ) {
    return recordRecordingCloseIntent(recordingSessionId, requestUserId, input);
  }
}

export const recordingsService = new RecordingsService();
