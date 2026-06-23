import { RecordingSessionIngestType } from "@prisma/client";
import { v4 as uuidv4 } from "uuid";

import { HLS_PLAYBACK_TICKET_TTL_SECONDS } from "../../constants/stream/stream-constants";
import type {
  HlsPlaybackTicketRecord,
  RecordingSessionLiveCache,
} from "../../types/stream";
import { redis } from "../infra/redis";
import { hlsPlaybackTicketKey, streamRecordingKey } from "./stream-keys";
import { normalizeTicketId, parseTicketRecord } from "./stream-ticket-record";

export type HlsPlaybackTicketValidationResult =
  | {
      ok: true;
      ticket: HlsPlaybackTicketRecord;
      ticketId: string;
      liveCache: RecordingSessionLiveCache;
    }
  | {
      ok: false;
      reason: string;
      ticketId: string | null;
    };

export type IssueHlsPlaybackTicketParams = {
  recordingSessionId: string;
  repositoryId: string;
  userId: string;
  streamPath: string;
};

export type HlsPlaybackTicketGrant = {
  ticket: HlsPlaybackTicketRecord;
  ticketId: string;
};

export const getHlsPlaybackTicketTtlSeconds = () => HLS_PLAYBACK_TICKET_TTL_SECONDS;

export const issueHlsPlaybackTicket = async (
  params: IssueHlsPlaybackTicketParams,
): Promise<HlsPlaybackTicketGrant> => {
  const ticketId = `pt_${uuidv4()}`;
  const ticket: HlsPlaybackTicketRecord = {
    recordingSessionId: params.recordingSessionId,
    repositoryId: params.repositoryId,
    userId: params.userId,
    ingestType: RecordingSessionIngestType.MEDIAMTX,
    streamPath: params.streamPath,
    status: "active",
  };

  await redis.set(
    hlsPlaybackTicketKey(ticketId),
    JSON.stringify(ticket),
    "EX",
    HLS_PLAYBACK_TICKET_TTL_SECONDS,
  );

  return { ticket, ticketId };
};

export const extractHlsPlaybackTicketId = (params: {
  token?: string | null | undefined;
  query?: string | null | undefined;
  password?: string | null | undefined;
}): string | null => {
  const token = normalizeTicketId(params.token);
  if (token) {
    return token;
  }

  const queryParams = new URLSearchParams(params.query ?? "");
  const queryTicket = normalizeTicketId(queryParams.get("ticket"));
  if (queryTicket) {
    return queryTicket;
  }

  const queryToken = normalizeTicketId(queryParams.get("token"));
  if (queryToken) {
    return queryToken;
  }

  return normalizeTicketId(params.password);
};

export const validateHlsPlaybackTicket = async (
  streamPath: string,
  ticketId?: string | null,
): Promise<HlsPlaybackTicketValidationResult> => {
  const normalizedTicketId = normalizeTicketId(ticketId);
  if (!normalizedTicketId) {
    return {
      ok: false,
      reason: "missing-playback-ticket",
      ticketId: null,
    };
  }

  const ticketKey = hlsPlaybackTicketKey(normalizedTicketId);
  const raw = await redis.get(ticketKey);
  if (!raw) {
    return {
      ok: false,
      reason: "unknown-or-expired-playback-ticket",
      ticketId: normalizedTicketId,
    };
  }

  const ticket = parseTicketRecord<HlsPlaybackTicketRecord>(raw);
  if (!ticket) {
    return {
      ok: false,
      reason: "malformed-playback-ticket-record",
      ticketId: normalizedTicketId,
    };
  }

  if (ticket.status !== "active") {
    return {
      ok: false,
      reason: `playback-ticket-status-${String(ticket.status).toLowerCase()}`,
      ticketId: normalizedTicketId,
    };
  }

  if (ticket.streamPath !== streamPath) {
    return {
      ok: false,
      reason: "playback-ticket-stream-path-mismatch",
      ticketId: normalizedTicketId,
    };
  }

  const liveRaw = await redis.get(streamRecordingKey(ticket.recordingSessionId));
  if (!liveRaw) {
    return {
      ok: false,
      reason: "live-cache-missing",
      ticketId: normalizedTicketId,
    };
  }

  const liveCache = parseTicketRecord<RecordingSessionLiveCache>(liveRaw);
  if (!liveCache) {
    return {
      ok: false,
      reason: "malformed-live-cache",
      ticketId: normalizedTicketId,
    };
  }

  if (liveCache.status !== "STREAMING") {
    return {
      ok: false,
      reason: "live-cache-not-streaming",
      ticketId: normalizedTicketId,
    };
  }

  if (liveCache.repositoryId !== ticket.repositoryId) {
    return {
      ok: false,
      reason: "live-cache-repository-mismatch",
      ticketId: normalizedTicketId,
    };
  }

  const expectedStreamPath = `live/${liveCache.repositoryName}/${ticket.recordingSessionId}`;
  if (expectedStreamPath !== ticket.streamPath) {
    return {
      ok: false,
      reason: "live-cache-stream-path-mismatch",
      ticketId: normalizedTicketId,
    };
  }

  const refreshed = await redis.expire(ticketKey, HLS_PLAYBACK_TICKET_TTL_SECONDS);
  if (!refreshed) {
    return {
      ok: false,
      reason: "unknown-or-expired-playback-ticket",
      ticketId: normalizedTicketId,
    };
  }

  return {
    ok: true,
    ticket,
    ticketId: normalizedTicketId,
    liveCache,
  };
};
