import {
  handleMediamtxSegmentComplete,
  handleMediamtxSegmentCreate,
} from "../lib/streaming/mediamtx-segment-hooks";
import {
  handleMediamtxStreamNotReady,
  handleMediamtxStreamReady,
} from "../lib/streaming/mediamtx-stream-hooks";
import type {
  SegmentCompleteHookInput,
  SegmentCreateHookInput,
  StreamNotReadyHookInput,
  StreamReadyHookInput,
} from "../types/stream/request";

/**
 * MediaMTX hook route use-case orchestration.
 *
 * route는 HTTP payload parsing만 담당하고, hook별 세션/세그먼트 상태 전이는 lib/streaming helper가 담당한다.
 */
export class HooksService {
  async handleStreamReady(input: StreamReadyHookInput) {
    await handleMediamtxStreamReady(input);
  }

  async handleStreamNotReady(input: StreamNotReadyHookInput) {
    await handleMediamtxStreamNotReady(input);
  }

  async handleSegmentCreate(input: SegmentCreateHookInput) {
    await handleMediamtxSegmentCreate(input);
  }

  async handleSegmentComplete(input: SegmentCompleteHookInput) {
    await handleMediamtxSegmentComplete(input);
  }
}

export const hooksService = new HooksService();
