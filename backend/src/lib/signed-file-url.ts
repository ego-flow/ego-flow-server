import path from "path";

import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";

import { runtimeConfig as env } from "../config/runtime";
import { toStorageRelativePath } from "./storage";

const SIGNED_FILE_URL_AUDIENCE = "egoflow:file";

type SignedFileUrlPayload = {
  kind: "file";
  path: string;
  exp?: number;
  iat?: number;
};

const normalizeRelativePath = (relativePath: string): string => relativePath.split(path.sep).join("/");

export const signFileUrlToken = (relativePath: string): string =>
  jwt.sign(
    {
      kind: "file",
      path: normalizeRelativePath(relativePath),
    } satisfies SignedFileUrlPayload,
    env.JWT_SECRET,
    {
      algorithm: "HS256",
      audience: SIGNED_FILE_URL_AUDIENCE,
      expiresIn: env.SIGNED_FILE_URL_EXPIRES_IN as NonNullable<SignOptions["expiresIn"]>,
    },
  );

export const verifySignedFileUrlToken = (token: string): SignedFileUrlPayload => {
  const payload = jwt.verify(token, env.JWT_SECRET, {
    algorithms: ["HS256"],
    audience: SIGNED_FILE_URL_AUDIENCE,
  }) as SignedFileUrlPayload;

  if (payload.kind !== "file" || typeof payload.path !== "string" || !payload.path) {
    throw new jwt.JsonWebTokenError("Invalid signed file URL.");
  }

  return payload;
};

export const toSignedFileUrl = (targetDirectory: string, filePath: string | null): string | null => {
  const relative = toStorageRelativePath(targetDirectory, filePath);
  if (!relative) {
    return null;
  }

  const normalizedPath = normalizeRelativePath(relative);
  const encodedPath = normalizedPath.split("/").map(encodeURIComponent).join("/");
  const signature = signFileUrlToken(normalizedPath);

  return `/files/${encodedPath}?signature=${encodeURIComponent(signature)}`;
};
