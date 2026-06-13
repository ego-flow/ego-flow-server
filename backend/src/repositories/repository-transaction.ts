import { prisma, runPrismaTransaction, type PrismaTransactionClient } from "../lib/infra/prisma";

export type RepositoryPersistenceClient = typeof prisma | PrismaTransactionClient;

export const defaultRepositoryPersistenceClient: RepositoryPersistenceClient = prisma;

export const isRootRepositoryPersistenceClient = (
  client: RepositoryPersistenceClient,
): client is typeof prisma =>
  typeof (client as typeof prisma).$transaction === "function" &&
  typeof (client as typeof prisma).$connect === "function";

export const runRepositoryTransaction = runPrismaTransaction;
