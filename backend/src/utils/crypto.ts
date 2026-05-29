import crypto from "crypto";

export const createPrefixedRandomToken = (prefix: string, randomBytes: number) =>
  `${prefix}${crypto.randomBytes(randomBytes).toString("hex")}`;

export const hashValue = (value: string, algorithm: string) =>
  crypto.createHash(algorithm).update(value).digest("hex");
