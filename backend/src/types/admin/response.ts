import type { AppUserRole } from "../auth";

export type AdminConfigValue = string | number | boolean | null;

export interface AdminSettingsEntry {
  key: string;
  value: AdminConfigValue;
  sensitive?: boolean;
  sourcePath?: string;
  children?: AdminSettingsEntry[];
}

export interface AdminSettingsEntryResponse {
  key: string;
  value: AdminConfigValue;
  sensitive: boolean;
  source_path: string | null;
  children: AdminSettingsEntryResponse[];
}

export interface AdminSettingsSectionResponse {
  title: string;
  description: string | null;
  entries: AdminSettingsEntryResponse[];
}

export interface AdminSettingsResponse {
  target_directory: string;
  config_path: string;
  dotenv_path: string;
  sections: AdminSettingsSectionResponse[];
}

export interface AdminUserResponse {
  id: string;
  role: AppUserRole;
  displayName: string;
  createdAt: string;
  deactivated: boolean;
}
