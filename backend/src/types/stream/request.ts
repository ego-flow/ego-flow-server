import type { z } from "zod";

import type {
  httpStreamChunkHeadersSchema,
  httpStreamFinishSchema,
  httpStreamStartSchema,
  publishTicketParamsSchema,
  recordingCloseIntentSchema,
  recordingSessionIdParamsSchema,
  segmentCompleteHookSchema,
  segmentCreateHookSchema,
  streamNotReadyHookSchema,
  streamReadyHookSchema,
  streamRegisterSchema,
} from "../../schemas/stream.schema";
import type { liveStreamRecordingSessionParamSchema } from "../../schemas/live-stream.schema";

export type StreamRegisterInput = z.infer<typeof streamRegisterSchema>;
export type PublishTicketParams = z.infer<typeof publishTicketParamsSchema>;
export type StreamReadyHookInput = z.infer<typeof streamReadyHookSchema>;
export type StreamNotReadyHookInput = z.infer<typeof streamNotReadyHookSchema>;
export type SegmentCreateHookInput = z.infer<typeof segmentCreateHookSchema>;
export type SegmentCompleteHookInput = z.infer<typeof segmentCompleteHookSchema>;
export type RecordingSessionIdParams = z.infer<typeof recordingSessionIdParamsSchema>;
export type RecordingCloseIntentInput = z.infer<typeof recordingCloseIntentSchema>;
export type HttpStreamStartInput = z.infer<typeof httpStreamStartSchema>;
export type HttpStreamFinishInput = z.infer<typeof httpStreamFinishSchema>;
export type HttpStreamChunkHeadersInput = z.infer<typeof httpStreamChunkHeadersSchema>;
export type LiveStreamRecordingSessionParamInput = z.infer<typeof liveStreamRecordingSessionParamSchema>;

export interface HttpStreamChunkInput {
  sequence: number;
  offset: number;
  chunk: Buffer;
}
