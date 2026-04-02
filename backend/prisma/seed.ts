import bcrypt from "bcryptjs";
import { PrismaClient, UserRole } from "@prisma/client";

import { runtimeConfig as env } from "../src/config/runtime";

const prisma = new PrismaClient();

async function main() {
  const existingAdmin = await prisma.user.findUnique({
    where: { id: "admin" },
    select: { id: true },
  });

  if (!existingAdmin) {
    const adminPasswordHash = await bcrypt.hash(env.ADMIN_DEFAULT_PASSWORD, 10);

    await prisma.user.create({
      data: {
        id: "admin",
        passwordHash: adminPasswordHash,
        role: UserRole.admin,
        isActive: true,
        displayName: "Administrator",
      },
    });
  }

  const existingTargetDirectorySetting = await prisma.setting.findUnique({
    where: { key: "target_directory" },
  });

  if (!existingTargetDirectorySetting) {
    await prisma.setting.create({
      data: {
        key: "target_directory",
        value: env.TARGET_DIRECTORY,
      },
    });
  }

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
