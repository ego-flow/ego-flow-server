import type { Request } from "express";

import { Internal, Unauthorized } from "./errors";
import type { AuthenticatedUser } from "../types/auth";
import type { RepositoryAccessContext } from "../types/repository";
import type { HttpStreamChunkInput } from "../types/stream";

export const getAuthUser = (req: Request): AuthenticatedUser => {
  if (!req.user) {
    throw Unauthorized();
  }
  return req.user;
};

export const getRepositoryAccess = (req: Request): RepositoryAccessContext => {
  if (!req.repositoryAccess) {
    throw Internal("Repository access context is missing.");
  }
  return req.repositoryAccess;
};

export const getHttpStreamChunk = (req: Request): HttpStreamChunkInput => {
  if (!req.httpStreamChunk) {
    throw Internal("HTTP stream chunk context is missing.");
  }
  return req.httpStreamChunk;
};
