import fs from "fs";
import path from "path";

import dotenv from "dotenv";
import { z } from "zod";

const getProjectRootDir = () => path.resolve(__dirname, "../../..");

const resolveEnvPath = (value: string | undefined) => {
  if (!value) {
    return path.join(getProjectRootDir(), ".env");
  }

  return path.isAbsolute(value) ? value : path.resolve(getProjectRootDir(), value);
};

const dotenvPath = resolveEnvPath(process.env.DOTENV_PATH);

if (!fs.existsSync(dotenvPath)) {
  console.error(`Missing env file: ${dotenvPath}`);
  console.error("Create it from .env.example before starting the server.");
  process.exit(1);
}

dotenv.config({ path: dotenvPath, override: false });

const optionalNonEmptyString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  ADMIN_DEFAULT_PASSWORD: z.string().min(8),
  HF_TOKEN: optionalNonEmptyString,
  PUBLIC_RTMP_BASE_URL: optionalNonEmptyString,
  MEDIAMTX_API_URL: optionalNonEmptyString,
  RTMPS_ENCRYPTION_MODE: z.enum(["no", "optional", "strict"]).optional(),
  RTMPS_CERT_PATH: optionalNonEmptyString,
  RTMPS_KEY_PATH: optionalNonEmptyString,
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error(`Invalid environment variables from ${dotenvPath}:`, parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
