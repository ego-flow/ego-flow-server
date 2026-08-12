import { Prisma } from "@prisma/client";
import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

import { AppError, ErrorCode } from "../lib/core/errors";

const toAppError = (error: unknown): AppError => {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return new AppError(400, ErrorCode.VALIDATION_ERROR, "Request validation failed.", error.flatten());
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return new AppError(409, ErrorCode.CONFLICT, "Resource already exists.", {
        target: error.meta?.target ?? null,
      });
    }
    if (error.code === "P2025") {
      return new AppError(404, ErrorCode.NOT_FOUND, "Resource not found.");
    }
  }

  return new AppError(500, ErrorCode.INTERNAL_ERROR, "Unexpected server error.");
};

export const errorMiddleware = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
  const appError = toAppError(error);

  if (appError.statusCode >= 500) {
    console.error("[error]", {
      code: appError.code,
      statusCode: appError.statusCode,
      method: req.method,
      path: req.originalUrl,
      userId: req.user?.userId,
      message: appError.message,
      cause: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : error,
    });
  }

  return res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details !== undefined ? { details: appError.details } : {}),
    },
  });
};
