import type { AuthenticatedUser } from "./auth";
import type { RepositoryAccessContext } from "./repository";

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
    repositoryAccess?: RepositoryAccessContext;
  }
}

export {};
