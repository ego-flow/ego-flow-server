import type { AppUserRole } from "./model";

export interface CredentialUserResponse {
  id: string;
  role: AppUserRole;
  displayName: string;
}

export interface AuthenticatedUserResponse {
  id: string;
  role: AppUserRole;
  display_name: string;
}
