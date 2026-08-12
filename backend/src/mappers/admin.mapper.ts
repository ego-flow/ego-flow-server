import { UserRole } from "@prisma/client";

import type {
  AdminSettingsEntry,
  AdminSettingsEntryResponse,
  AdminUserResponse,
} from "../types/admin";
import { toAppUserRole } from "./user.mapper";

export const toAdminUserResponse = (user: {
  id: string;
  role: UserRole;
  displayName: string;
  createdAt: Date;
  deactivated: boolean;
}): AdminUserResponse => ({
  id: user.id,
  role: toAppUserRole(user.role),
  displayName: user.displayName,
  createdAt: user.createdAt.toISOString(),
  deactivated: user.deactivated,
});

export const toAdminSettingsEntryResponse = (
  entry: AdminSettingsEntry,
): AdminSettingsEntryResponse => ({
  key: entry.key,
  value: entry.value,
  sensitive: Boolean(entry.sensitive),
  source_path: entry.sourcePath ?? null,
  children: (entry.children ?? []).map(toAdminSettingsEntryResponse),
});
