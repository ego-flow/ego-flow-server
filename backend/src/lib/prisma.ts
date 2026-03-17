import { PrismaClient } from "@prisma/client";

declare global {
  // eslint-disable-next-line no-var
  var __egoflowPrisma: PrismaClient | undefined;
}

export const prisma =
  global.__egoflowPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "warn", "error"] : ["warn", "error"],
  });

if (process.env.NODE_ENV !== "production") {
  global.__egoflowPrisma = prisma;
}
