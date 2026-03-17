import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const booleanFromString = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value, ctx) => {
    if (["true", "1", "yes", "on"].includes(value)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(value)) {
      return false;
    }
    ctx.addIssue({
      code: "custom",
      message: "Must be a boolean-like string",
    });
    return z.NEVER;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  CORS_ORIGIN: z.string().default("*"),
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@127.0.0.1:5432/egoflow?schema=public"),
  REDIS_URL: z.string().min(1).default("redis://127.0.0.1:6379"),
  JWT_SECRET: z.string().min(16).default("replace-this-in-production"),
  JWT_EXPIRES_IN: z.string().default("24h"),
  JWT_REFRESH_THRESHOLD_SECONDS: z.coerce.number().int().positive().default(6 * 60 * 60),
  ADMIN_DEFAULT_PASSWORD: z.string().min(8).default("changeme123"),
  TARGET_DIRECTORY: z.string().min(1).default("/data/datasets"),
  RTMP_BASE_URL: z.string().min(1).default("rtmp://127.0.0.1:1935/live"),
  HLS_BASE_URL: z.string().min(1).default("http://127.0.0.1:8888"),
  BULLMQ_QUEUE_NAME: z.string().min(1).default("video-processing"),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  DELETE_RAW_AFTER_PROCESSING: z.preprocess(
    (input) => (input === undefined ? "true" : input),
    booleanFromString,
  ),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
