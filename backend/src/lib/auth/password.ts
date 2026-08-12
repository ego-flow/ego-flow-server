import bcrypt from "bcryptjs";

const PASSWORD_HASH_ROUNDS = 10;

export const verifyPassword = (plainPassword: string, passwordHash: string) =>
  bcrypt.compare(plainPassword, passwordHash);

export const hashPassword = (plainPassword: string) => bcrypt.hash(plainPassword, PASSWORD_HASH_ROUNDS);
