import assert from "node:assert/strict";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { test } from "node:test";

import { computeFileDigestAndSize } from "../src/lib/file-utils";

test("computeFileDigestAndSize returns SHA-256 and byte size in a single streaming pass", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "egoflow-file-utils-"));
  const filePath = path.join(tempDir, "sample.bin");
  const content = Buffer.from("ego-flow-task-2-sample-data");

  await fs.writeFile(filePath, content);

  const result = await computeFileDigestAndSize(filePath);

  assert.equal(result.sizeBytes, BigInt(content.length));
  assert.equal(
    result.sha256,
    crypto.createHash("sha256").update(content).digest("hex"),
  );

  await fs.rm(tempDir, { recursive: true, force: true });
});
