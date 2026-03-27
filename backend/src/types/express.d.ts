import type { AuthTokenPayload } from "./auth";
import type { RepositoryAccessContext } from "./repository";

declare module "express-serve-static-core" {
  interface Request {
    user?: Pick<AuthTokenPayload, "userId" | "role">;
    repositoryAccess?: RepositoryAccessContext;
  }
}

export {};
