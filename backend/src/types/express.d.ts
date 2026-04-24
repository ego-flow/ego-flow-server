import type { AuthContext, AuthenticatedUser } from "./auth";
import type { RepositoryAccessContext } from "./repository";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
    user?: AuthenticatedUser;
    repositoryAccess?: RepositoryAccessContext;
  }
}

export {};
