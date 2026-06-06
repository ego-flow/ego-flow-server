import { prisma } from "../lib/infra/prisma";

export class SettingRepository {
  async findValue(key: string): Promise<string | null> {
    const setting = await prisma.setting.findUnique({
      where: { key },
      select: { value: true },
    });

    return setting?.value ?? null;
  }

  async updateValue(key: string, value: string): Promise<void> {
    await prisma.setting.update({
      where: { key },
      data: { value },
    });
  }

  async createValue(key: string, value: string): Promise<void> {
    await prisma.setting.create({
      data: { key, value },
    });
  }
}

export const settingRepository = new SettingRepository();
