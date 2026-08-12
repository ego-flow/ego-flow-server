import test from "node:test";
import assert from "node:assert/strict";

import { expandHomePath, normalizeTargetDirectory } from "../src/config/path-utils";

test("expandHomePath expands bare tilde and ~/ paths", () => {
  assert.equal(expandHomePath("~", "/home/egoflow"), "/home/egoflow");
  assert.equal(
    expandHomePath("~/datasets/project-a", "/home/egoflow"),
    "/home/egoflow/datasets/project-a",
  );
});

test("normalizeTargetDirectory accepts absolute paths", () => {
  assert.equal(
    normalizeTargetDirectory("/srv/egoflow/datasets", "/home/egoflow"),
    "/srv/egoflow/datasets",
  );
});

test("normalizeTargetDirectory expands ~/ paths to absolute paths", () => {
  assert.equal(
    normalizeTargetDirectory("~/datasets/project-a", "/home/egoflow"),
    "/home/egoflow/datasets/project-a",
  );
});

test("normalizeTargetDirectory rejects relative paths", () => {
  assert.throws(
    () => normalizeTargetDirectory("datasets/project-a", "/home/egoflow"),
    /absolute path/,
  );
});
