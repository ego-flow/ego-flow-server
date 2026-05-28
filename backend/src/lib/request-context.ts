import type { Request } from "express";

import { Internal, Unauthorized } from "./errors";
import type { AuthContext, AuthenticatedUser } from "../types/auth";
import type { RepositoryAccessContext } from "../types/repository";

export const getAuthUser = (req: Request): AuthenticatedUser => {
  if (!req.user) {
    throw Unauthorized();
  }
  return req.user;
};

export const getAuthContext = (req: Request): AuthContext => {
  if (!req.auth) {
    throw Unauthorized();
  }
  return req.auth;
};

export const getRepositoryAccess = (req: Request): RepositoryAccessContext => {
  if (!req.repositoryAccess) {
    throw Internal("Repository access context is missing.");
  }
  return req.repositoryAccess;
};
