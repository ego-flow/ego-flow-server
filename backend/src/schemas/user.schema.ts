import { z } from "zod";

export const changeMyPasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
});
