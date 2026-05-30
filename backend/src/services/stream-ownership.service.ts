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

  async issuePublishTicket(params: {
    recordingSessionId: string;
    repositoryId: string;
    userId: string;
    streamPath: string;
  }): Promise<{ ticket: PublishTicketRecord }> {
    const now = Date.now();
    const ticketId = `t_${uuidv4()}`;
    const expiresAt = now + PUBLISH_TICKET_TTL_SECONDS * 1000;
    const ticket: PublishTicketRecord = {
      ticketId,
      recordingSessionId: params.recordingSessionId,
      repositoryId: params.repositoryId,
      userId: params.userId,
      streamPath: params.streamPath,
      issuedAt: now,
      expiresAt,
      status: "active",
    };

    await redis.set(streamTicketKey(ticketId), JSON.stringify(ticket), "EX", PUBLISH_TICKET_TTL_SECONDS);

    return { ticket };
  }

  async validatePublishTicket(streamPath: string, query?: string): Promise<PublishTicketValidationResult> {
    const ticketId = this.extractTicketId(query);
    if (!ticketId) {
      return {
        ok: false,
        reason: "missing-publish-ticket",
        ticketId: null,
      };
    }

    const raw = await redis.get(streamTicketKey(ticketId));
    if (!raw) {
      return {
        ok: false,
        reason: "unknown-or-expired-ticket",
        ticketId,
      };
    }

    let ticket: PublishTicketRecord;
    try {
      ticket = JSON.parse(raw) as PublishTicketRecord;
    } catch (_error) {
      return {
        ok: false,
        reason: "malformed-ticket-record",
        ticketId,
      };
    }

    if (ticket.status !== "active") {
      return {
        ok: false,
        reason: `ticket-status-${ticket.status.toLowerCase()}`,
        ticketId,
      };
    }

    if (ticket.expiresAt <= Date.now()) {
      return {
        ok: false,
        reason: "ticket-expired",
        ticketId,
      };
    }

    if (ticket.streamPath !== streamPath) {
      return {
        ok: false,
        reason: "ticket-stream-path-mismatch",
        ticketId,
      };
    }

    return {
      ok: true,
      ticket,
      ticketId,
    };
  }

  async consumePublishTicket(streamPath: string, query?: string): Promise<PublishTicketConsumeResult> {
    const validation = await this.validatePublishTicket(streamPath, query);
    if (!validation.ok) {
      return validation;
    }

    const remainingTtlSeconds = this.calculateRemainingTtlSeconds(validation.ticket.expiresAt);
    const nextTicket: PublishTicketRecord = {
      ...validation.ticket,
      status: "consumed",
    };

    await redis.set(
      streamTicketKey(validation.ticket.ticketId),
      JSON.stringify(nextTicket),
      "EX",
      remainingTtlSeconds,
    );

    return {
      ok: true,
      ticket: nextTicket,
    };
  }

  extractTicketId(query?: string) {
    const queryParams = new URLSearchParams(query ?? "");
    const ticketId = queryParams.get("ticket");
    return ticketId && ticketId.trim() ? ticketId.trim() : null;
  }

  private calculateRemainingTtlSeconds(expiresAt: number) {
    return Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000));
  }
}

export const streamOwnershipService = new StreamOwnershipService();
