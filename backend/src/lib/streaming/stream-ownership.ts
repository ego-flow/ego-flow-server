import {
  extractHlsPlaybackTicketId,
  extractHlsPlaybackUserId,
  getHlsPlaybackTicketTtlSeconds,
  issueHlsPlaybackTicket,
  validateHlsPlaybackTicket,
  type HlsPlaybackTicketGrant,
  type HlsPlaybackTicketValidationOptions,
  type HlsPlaybackTicketValidationResult,
  type IssueHlsPlaybackTicketParams,
} from "./hls-playback-ticket";
import {
  consumeValidatedPublishTicket,
  extractTicketId,
  getPublishTicketTtlSeconds,
  issuePublishTicket,
  validatePublishTicket,
  type IssuePublishTicketParams,
  type PublishTicketConsumeResult,
  type PublishTicketGrant,
  type PublishTicketValidationOptions,
  type PublishTicketValidationResult,
} from "./publish-ticket";

export class StreamOwnershipService {
  getPublishTicketTtlSeconds() {
    return getPublishTicketTtlSeconds();
  }

  getHlsPlaybackTicketTtlSeconds() {
    return getHlsPlaybackTicketTtlSeconds();
  }

  async issuePublishTicket(params: IssuePublishTicketParams): Promise<PublishTicketGrant> {
    return issuePublishTicket(params);
  }

  async issueHlsPlaybackTicket(params: IssueHlsPlaybackTicketParams): Promise<HlsPlaybackTicketGrant> {
    return issueHlsPlaybackTicket(params);
  }

  async validatePublishTicket(
    streamPath: string,
    ticketId?: string | null,
    options: PublishTicketValidationOptions = {},
  ): Promise<PublishTicketValidationResult> {
    return validatePublishTicket(streamPath, ticketId, options);
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

    return consumeValidatedPublishTicket(validation);
  }

  extractTicketId(query?: string) {
    return extractTicketId(query);
  }

  extractHlsPlaybackTicketId(params: {
    token?: string | null | undefined;
    query?: string | null | undefined;
    password?: string | null | undefined;
  }) {
    return extractHlsPlaybackTicketId(params);
  }

  extractHlsPlaybackUserId(params: {
    user?: string | null | undefined;
    query?: string | null | undefined;
  }) {
    return extractHlsPlaybackUserId(params);
  }

  async validateHlsPlaybackTicket(
    streamPath: string,
    ticketId?: string | null,
    options: HlsPlaybackTicketValidationOptions = {},
  ): Promise<HlsPlaybackTicketValidationResult> {
    return validateHlsPlaybackTicket(streamPath, ticketId, options);
  }
}

export const streamOwnershipService = new StreamOwnershipService();
