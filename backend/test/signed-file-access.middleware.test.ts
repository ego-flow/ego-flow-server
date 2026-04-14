import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { AddressInfo } from "node:net";

import express from "express";

import { errorMiddleware } from "../src/middleware/error.middleware";

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:5432/egoflow";
process.env.REDIS_URL ??= "redis://127.0.0.1:6379";
process.env.JWT_SECRET ??= "replace-this-in-tests-only";
process.env.ADMIN_DEFAULT_PASSWORD ??= "changeme123";

const { requireSignedFileAccess } =
  require("../src/middleware/signed-file-access.middleware") as typeof import("../src/middleware/signed-file-access.middleware");
const { signFileUrlToken } =
  require("../src/lib/signed-file-url") as typeof import("../src/lib/signed-file-url");

let server: import("node:http").Server | null = null;

const startServer = async () => {
  const app = express();
  app.use(
    "/files",
    requireSignedFileAccess,
    (req, res) => {
      res.status(200).json({ ok: true, path: req.path });
    },
  );
  app.use(errorMiddleware);

  server = await new Promise<import("node:http").Server>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
    server = null;
  }
});

test("signed file access accepts only matching signed paths", async () => {
  const baseUrl = await startServer();
  const relativePath = "alice/daily-kitchen/.dashboard/video-1.mp4";
  const signature = signFileUrlToken(relativePath);

  const allowedResponse = await fetch(`${baseUrl}/files/${relativePath}?signature=${encodeURIComponent(signature)}`);
  assert.equal(allowedResponse.status, 200);
  assert.deepEqual(await allowedResponse.json(), {
    ok: true,
    path: `/${relativePath}`,
  });

  const mismatchedResponse = await fetch(
    `${baseUrl}/files/alice/daily-kitchen/.dashboard/video-2.mp4?signature=${encodeURIComponent(signature)}`,
  );
  assert.equal(mismatchedResponse.status, 401);
  assert.equal((await mismatchedResponse.json()).error.code, "UNAUTHORIZED");

  const missingSignatureResponse = await fetch(`${baseUrl}/files/${relativePath}`);
  assert.equal(missingSignatureResponse.status, 401);
  assert.equal((await missingSignatureResponse.json()).error.code, "UNAUTHORIZED");
});
