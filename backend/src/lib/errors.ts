export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export const ErrorCode = {
  VALIDATION_ERROR: "VALIDATION_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  REGISTRATION_TIMEOUT: "REGISTRATION_TIMEOUT",
  STALE_PUBLISH_CONNECTION: "STALE_PUBLISH_CONNECTION",
  OWNER_LEASE_MISSING: "OWNER_LEASE_MISSING",
  INVALID_FILE_PATH: "INVALID_FILE_PATH",
  INVALID_SLUG: "INVALID_SLUG",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const BadRequest = (
  message: string,
  code: ErrorCode = ErrorCode.VALIDATION_ERROR,
  details?: unknown,
) => new AppError(400, code, message, details);

export const Unauthorized = (
  message = "Authentication is required.",
  code: ErrorCode = ErrorCode.UNAUTHORIZED,
) => new AppError(401, code, message);

export const Forbidden = (message = "You do not have permission for this action.") =>
  new AppError(403, ErrorCode.FORBIDDEN, message);

export const NotFound = (message: string, details?: unknown) =>
  new AppError(404, ErrorCode.NOT_FOUND, message, details);

export const Conflict = (
  message: string,
  code: ErrorCode = ErrorCode.CONFLICT,
  details?: unknown,
) => new AppError(409, code, message, details);

export const Upstream = (
  message: string,
  details?: unknown,
) => new AppError(502, ErrorCode.UPSTREAM_ERROR, message, details);

export const Internal = (
  message = "Unexpected server error.",
  details?: unknown,
) => new AppError(500, ErrorCode.INTERNAL_ERROR, message, details);
