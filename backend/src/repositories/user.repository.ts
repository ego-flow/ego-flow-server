import { prisma } from "../lib/prisma";
import { toAuthenticatedUser } from "../mappers/user.mapper";
import type { AuthenticatedUser } from "../types/auth";

export class UserRepository {
  async findActiveAuthenticatedUser(userId: string): Promise<AuthenticatedUser | null> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        role: true,
        deactivated: true,
        displayName: true,
      },
    });

    if (!user || user.deactivated) {
      return null;
    }

    return toAuthenticatedUser(user);
  }
}

export const userRepository = new UserRepository();
