import { v4 as uuidv4 } from "uuid";

import { RecordingSessionIngestType } from "@prisma/client";

import { HLS_PLAYBACK_TICKET_TTL_SECONDS } from "../constants/stream/stream-constants";
import { PUBLISH_TICKET_TTL_SECONDS } from "../constants/stream/stream-ownership-constants";
import { redis } from "../lib/redis";
import type {
  HlsPlaybackTicketRecord,
  PublishTicketRecord,
  RecordingSessionIngestTypeValue,
  RecordingSessionLiveCache,
} from "../types/stream";
import { hlsPlaybackTicketKey, streamRecordingKey, streamTicketKey } from "../utils/stream-keys";

type PublishTicketValidationResult =
  | {
      ok: true;
      ticket: PublishTicketRecord;
      ticketId: string;
    }
  | {
      ok: false;
      reason: string;
      ticketId: string | null;
    };

type PublishTicketConsumeResult =
  | {
      ok: true;
      ticket: PublishTicketRecord;
      ticketId: string;
    }
  | {
      ok: false;
      reason: string;
      ticketId: string | null;
    };

type PublishTicketValidationOptions = {
  refreshTtl?: boolean;
  expectedIngestType?: RecordingSessionIngestTypeValue;
};

type HlsPlaybackTicketValidationResult =
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

export class StreamOwnershipService {
  getPublishTicketTtlSeconds() {
    return PUBLISH_TICKET_TTL_SECONDS;
  }

  getHlsPlaybackTicketTtlSeconds() {
    return HLS_PLAYBACK_TICKET_TTL_SECONDS;
  }

  async issuePublishTicket(params: {
    recordingSessionId: string;
    repositoryId: string;
    userId: string;
    ingestType: RecordingSessionIngestTypeValue;
    streamPath: string;
  }): Promise<{ ticket: PublishTicketRecord; ticketId: string }> {
    const ticketId = `t_${uuidv4()}`;
    const ticket: PublishTicketRecord = {
      recordingSessionId: params.recordingSessionId,
      repositoryId: params.repositoryId,
      userId: params.userId,
      ingestType: params.ingestType,
      streamPath: params.streamPath,
      status: "active",
    };

    await redis.set(streamTicketKey(ticketId), JSON.stringify(ticket), "EX", PUBLISH_TICKET_TTL_SECONDS);

    return { ticket, ticketId };
  }

  async issueHlsPlaybackTicket(params: {
    recordingSessionId: string;
    repositoryId: string;
    userId: string;
    streamPath: string;
  }): Promise<{ ticket: HlsPlaybackTicketRecord; ticketId: string; expiresAt: Date }> {
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

    return {
      ticket,
      ticketId,
      expiresAt: new Date(Date.now() + HLS_PLAYBACK_TICKET_TTL_SECONDS * 1000),
    };
  }

  async validatePublishTicket(
    streamPath: string,
    ticketId?: string | null,
    options: PublishTicketValidationOptions = {},
  ): Promise<PublishTicketValidationResult> {
    const normalizedTicketId = ticketId?.trim();
    if (!normalizedTicketId) {
      return {
        ok: false,
        reason: "missing-publish-ticket",
        ticketId: null,
      };
    }

    const ticketKey = streamTicketKey(normalizedTicketId);
    const raw = await redis.get(ticketKey);
    if (!raw) {
      return {
        ok: false,
        reason: "unknown-or-expired-ticket",
        ticketId: normalizedTicketId,
      };
    }

    let ticket: PublishTicketRecord;
    try {
      ticket = JSON.parse(raw) as PublishTicketRecord;
    } catch (_error) {
      return {
        ok: false,
        reason: "malformed-ticket-record",
        ticketId: normalizedTicketId,
      };
    }

    if (ticket.status !== "active") {
      return {
        ok: false,
        reason: `ticket-status-${ticket.status.toLowerCase()}`,
        ticketId: normalizedTicketId,
      };
    }

    if (ticket.streamPath !== streamPath) {
      return {
        ok: false,
        reason: "ticket-stream-path-mismatch",
        ticketId: normalizedTicketId,
      };
    }

    if (options.expectedIngestType && ticket.ingestType !== options.expectedIngestType) {
      return {
        ok: false,
        reason: "ticket-ingest-type-mismatch",
        ticketId: normalizedTicketId,
      };
    }

    if (options.refreshTtl ?? true) {
      const refreshed = await redis.expire(ticketKey, PUBLISH_TICKET_TTL_SECONDS);
      if (!refreshed) {
        return {
          ok: false,
          reason: "unknown-or-expired-ticket",
          ticketId: normalizedTicketId,
        };
      }
    }

    return {
      ok: true,
      ticket,
      ticketId: normalizedTicketId,
    };
  }

  async consumePublishTicket(
    streamPath: string,
    ticketId?: string | null,
    options: Pick<PublishTicketValidationOptions, "expectedIngestType"> = {},
  ): Promise<PublishTicketConsumeResult> {
    const validationOptions: PublishTicketValidationOptions = {
      refreshTtl: false,
    };
    if (options.expectedIngestType) {
      validationOptions.expectedIngestType = options.expectedIngestType;
    }

    const validation = await this.validatePublishTicket(streamPath, ticketId, validationOptions);
    if (!validation.ok) {
      return validation;
    }

    const nextTicket: PublishTicketRecord = {
      ...validation.ticket,
      status: "consumed",
    };

    const updated = await redis.set(
      streamTicketKey(validation.ticketId),
      JSON.stringify(nextTicket),
      "KEEPTTL",
      "XX",
    );
    if (updated !== "OK") {
      return {
        ok: false,
        reason: "unknown-or-expired-ticket",
        ticketId: validation.ticketId,
      };
    }

    return {
      ok: true,
      ticket: nextTicket,
      ticketId: validation.ticketId,
    };
  }

  extractTicketId(query?: string) {
    const queryParams = new URLSearchParams(query ?? "");
    const ticketId = queryParams.get("ticket");
    return ticketId && ticketId.trim() ? ticketId.trim() : null;
  }

  extractHlsPlaybackTicketId(params: {
    token?: string | null | undefined;
    query?: string | null | undefined;
    password?: string | null | undefined;
  }) {
    const token = params.token?.trim();
    if (token) {
      return token;
    }

    const queryParams = new URLSearchParams(params.query ?? "");
    const queryTicket = queryParams.get("ticket")?.trim();
    if (queryTicket) {
      return queryTicket;
    }

    const queryToken = queryParams.get("token")?.trim();
    if (queryToken) {
      return queryToken;
    }

    const password = params.password?.trim();
    return password || null;
  }

  async validateHlsPlaybackTicket(
    streamPath: string,
    ticketId?: string | null,
  ): Promise<HlsPlaybackTicketValidationResult> {
    const normalizedTicketId = ticketId?.trim();
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

    let ticket: HlsPlaybackTicketRecord;
    try {
      ticket = JSON.parse(raw) as HlsPlaybackTicketRecord;
    } catch (_error) {
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

    if (ticket.ingestType !== RecordingSessionIngestType.MEDIAMTX) {
      return {
        ok: false,
        reason: "playback-ticket-ingest-type-mismatch",
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

    let liveCache: RecordingSessionLiveCache;
    try {
      liveCache = JSON.parse(liveRaw) as RecordingSessionLiveCache;
    } catch (_error) {
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

    if (liveCache.ingestType !== RecordingSessionIngestType.MEDIAMTX) {
      return {
        ok: false,
        reason: "live-cache-not-mediamtx",
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
  }

}

export const streamOwnershipService = new StreamOwnershipService();
