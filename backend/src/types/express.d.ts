import type { AuthContext, AuthenticatedUser } from "./auth";
import type { RepositoryAccessContext } from "./repository";
import type { HttpStreamChunkInput } from "./stream";

declare module "express-serve-static-core" {
  interface Request {
    auth?: AuthContext;
    user?: AuthenticatedUser;
    repositoryAccess?: RepositoryAccessContext;
    httpStreamChunk?: HttpStreamChunkInput;
  }
}

export {};
