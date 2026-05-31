import { v4 as uuidv4 } from "uuid";

import { PUBLISH_TICKET_TTL_SECONDS } from "../constants/stream/stream-ownership-constants";
import { redis } from "../lib/redis";
import type { PublishTicketRecord } from "../types/stream";
import { streamTicketKey } from "../utils/stream-keys";

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
};

export class StreamOwnershipService {
  getPublishTicketTtlSeconds() {
    return PUBLISH_TICKET_TTL_SECONDS;
  }

  async issuePublishTicket(params: {
    recordingSessionId: string;
    repositoryId: string;
    userId: string;
    streamPath: string;
  }): Promise<{ ticket: PublishTicketRecord; ticketId: string }> {
    const ticketId = `t_${uuidv4()}`;
    const ticket: PublishTicketRecord = {
      recordingSessionId: params.recordingSessionId,
      repositoryId: params.repositoryId,
      userId: params.userId,
      streamPath: params.streamPath,
      status: "active",
    };

    await redis.set(streamTicketKey(ticketId), JSON.stringify(ticket), "EX", PUBLISH_TICKET_TTL_SECONDS);

    return { ticket, ticketId };
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

  async consumePublishTicket(streamPath: string, ticketId?: string | null): Promise<PublishTicketConsumeResult> {
    const validation = await this.validatePublishTicket(streamPath, ticketId, { refreshTtl: false });
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

}

export const streamOwnershipService = new StreamOwnershipService();
