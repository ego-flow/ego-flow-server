import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const { runtimeConfig } =
  require("../src/config/runtime") as typeof import("../src/config/runtime");
const { getServerInfo } =
  require("../src/lib/server-info") as typeof import("../src/lib/server-info");

test("getServerInfo exposes the expected public capability metadata", () => {
  assert.deepEqual(getServerInfo(), {
    api_version: "v1",
    server_version: "0.1.0",
    capabilities: {
      dataset_manifest: true,
      video_download: true,
      thumbnail_download: true,
      live_streams: true,
      python_tokens: true,
    },
    urls: {
      api_base: "/api/v1",
      hls_base: runtimeConfig.HLS_PATH_PREFIX,
    },
  });
});
