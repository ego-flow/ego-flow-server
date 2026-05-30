import fs from "fs";

import { z } from "zod";
import { DEFAULT_CONFIG_FILE_NAME } from "../constants/config/config-constants";
import { normalizeTargetDirectory, resolveConfiguredPath } from "./path-utils";

const configFileSchema = z.object({
  TARGET_DIRECTORY: z.string().transform((value, ctx) => {
    try {
      return normalizeTargetDirectory(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof Error ? error.message : "Invalid TARGET_DIRECTORY.",
      });
      return z.NEVER;
    }
  }),
  PUBLIC_HTTP_PORT: z.coerce.number().int().positive().default(80),
  WEBRTC_PORT: z.coerce.number().int().positive().default(8889),
  CORS_ORIGIN: z.string().default("*"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  DELETE_RAW_AFTER_PROCESSING: z.boolean().default(true),
  JWT_EXPIRES_IN: z.string().default("24h"),
  JWT_REFRESH_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(6 * 60 * 60),
  SIGNED_FILE_URL_EXPIRES_IN: z.string().default("6h"),
});

export const getConfigFilePath = () => resolveConfiguredPath(process.env.CONFIG_PATH, DEFAULT_CONFIG_FILE_NAME);

const configFilePath = getConfigFilePath();

if (!fs.existsSync(configFilePath)) {
  console.error(`Missing config file: ${configFilePath}`);
  console.error("Create it from config.json.example before starting the server.");
  process.exit(1);
}

let parsedJson: unknown;
try {
  const raw = fs.readFileSync(configFilePath, "utf8");
  parsedJson = JSON.parse(raw);
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`Failed to read config file ${configFilePath}: ${message}`);
  process.exit(1);
}

const parsed = configFileSchema.safeParse(parsedJson);

if (!parsed.success) {
  console.error("Invalid config.json:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const fileConfig = parsed.data;
