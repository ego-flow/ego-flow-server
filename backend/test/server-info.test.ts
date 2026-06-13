import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const { getServerInfo } =
  require("../src/lib/server/server-info") as typeof import("../src/lib/server/server-info");

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
  });
});
