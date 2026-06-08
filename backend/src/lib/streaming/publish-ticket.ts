import { v4 as uuidv4 } from "uuid";

import { PUBLISH_TICKET_TTL_SECONDS } from "../../constants/stream/stream-ownership-constants";
import type {
  PublishTicketRecord,
  RecordingSessionIngestTypeValue,
} from "../../types/stream";
import { redis } from "../infra/redis";
import { streamTicketKey } from "./stream-keys";
import { normalizeTicketId, parseTicketRecord } from "./stream-ticket-record";

export type PublishTicketValidationResult =
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

export type PublishTicketConsumeResult =
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

export type PublishTicketValidationOptions = {
  refreshTtl?: boolean;
  expectedIngestType?: RecordingSessionIngestTypeValue;
};

export type IssuePublishTicketParams = {
  recordingSessionId: string;
  repositoryId: string;
  userId: string;
  ingestType: RecordingSessionIngestTypeValue;
  streamPath: string;
};

export type PublishTicketGrant = {
  ticket: PublishTicketRecord;
  ticketId: string;
};

type ValidPublishTicket = Extract<PublishTicketValidationResult, { ok: true }>;

export const getPublishTicketTtlSeconds = () => PUBLISH_TICKET_TTL_SECONDS;

export const issuePublishTicket = async (
  params: IssuePublishTicketParams,
): Promise<PublishTicketGrant> => {
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
};

export const validatePublishTicket = async (
  streamPath: string,
  ticketId?: string | null,
  options: PublishTicketValidationOptions = {},
): Promise<PublishTicketValidationResult> => {
  const normalizedTicketId = normalizeTicketId(ticketId);
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

  const ticket = parseTicketRecord<PublishTicketRecord>(raw);
  if (!ticket) {
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
};

export const consumeValidatedPublishTicket = async (
  validation: ValidPublishTicket,
): Promise<PublishTicketConsumeResult> => {
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
};

export const consumePublishTicket = async (
  streamPath: string,
  ticketId?: string | null,
  options: Pick<PublishTicketValidationOptions, "expectedIngestType"> = {},
): Promise<PublishTicketConsumeResult> => {
  const validationOptions: PublishTicketValidationOptions = {
    refreshTtl: false,
  };
  if (options.expectedIngestType) {
    validationOptions.expectedIngestType = options.expectedIngestType;
  }

  const validation = await validatePublishTicket(streamPath, ticketId, validationOptions);
  if (!validation.ok) {
    return validation;
  }

  return consumeValidatedPublishTicket(validation);
};

export const extractTicketId = (query?: string): string | null => {
  const queryParams = new URLSearchParams(query ?? "");
  return normalizeTicketId(queryParams.get("ticket"));
};
