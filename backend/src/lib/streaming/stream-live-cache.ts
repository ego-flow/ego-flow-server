import { STREAM_ACTIVE_SET_KEY } from "../../constants/stream/stream-constants";
import { redis } from "../infra/redis";
import { streamRecordingKey } from "./stream-keys";

/**
 * Redis live pointer 삭제.
 * 스트림 종료 hook/reconcile에서 active set 후보와 live cache를 함께 제거한다.
 */
export async function clearLivePointers(
  recordingSessionId: string,
  repositoryId: string,
  repositoryName: string,
) {
  const recordingKey = streamRecordingKey(recordingSessionId);
  const results = await redis.multi()
    .del(recordingKey)
    .srem(STREAM_ACTIVE_SET_KEY, recordingSessionId)
    .exec();
  const deleted = Number(results?.[0]?.[1] ?? 0);
  const removed = Number(results?.[1]?.[1] ?? 0);

  if (deleted > 0 || removed > 0) {
    console.info("[rtmp-state] live-pointers-cleared", {
      recordingSessionId,
      repositoryId,
      repositoryName,
      recordingKey,
      activeSetKey: STREAM_ACTIVE_SET_KEY,
    });
  }
}
