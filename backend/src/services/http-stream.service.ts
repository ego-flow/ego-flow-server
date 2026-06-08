import {
  appendHttpStreamChunk,
  finishHttpStream,
  startHttpStream,
} from "../lib/streaming/http-stream-ingest";
import type {
  HttpStreamChunkInput,
  HttpStreamFinishInput,
  HttpStreamStartInput,
} from "../types/stream/request";
import type {
  HttpStreamAppendChunkResponse,
  HttpStreamFinishResponse,
  HttpStreamStartResponse,
} from "../types/stream/response";

export class HttpStreamService {
  async start(
    recordingSessionId: string,
    requestUserId: string,
    input: HttpStreamStartInput,
  ): Promise<HttpStreamStartResponse> {
    return startHttpStream(recordingSessionId, requestUserId, input);
  }

  async appendChunk(
    recordingSessionId: string,
    requestUserId: string,
    input: HttpStreamChunkInput,
  ): Promise<HttpStreamAppendChunkResponse> {
    return appendHttpStreamChunk(recordingSessionId, requestUserId, input);
  }

  async finish(
    recordingSessionId: string,
    requestUserId: string,
    input: HttpStreamFinishInput,
  ): Promise<HttpStreamFinishResponse> {
    return finishHttpStream(recordingSessionId, requestUserId, input);
  }
}

export const httpStreamService = new HttpStreamService();
