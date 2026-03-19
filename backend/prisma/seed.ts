import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

import { env } from "../src/config/env";

const prisma = new PrismaClient();

async function main() {
  const adminPasswordHash = await bcrypt.hash(env.ADMIN_DEFAULT_PASSWORD, 10);

  await prisma.user.upsert({
    where: { id: "admin" },
    update: {
      passwordHash: adminPasswordHash,
      role: UserRole.admin,
      isActive: true,
      displayName: "Administrator",
    },
    create: {
      id: "admin",
      passwordHash: adminPasswordHash,
      role: UserRole.admin,
      isActive: true,
      displayName: "Administrator",
    },
  });

  await prisma.setting.upsert({
    where: { key: "target_directory" },
    update: { value: env.TARGET_DIRECTORY },
    create: {
      key: "target_directory",
      value: env.TARGET_DIRECTORY,
    },
  });

  console.log("Seed complete: admin user and target_directory setting are ready.");
}

main()
  .catch((error) => {
    console.error("Seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
