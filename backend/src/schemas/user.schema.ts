import { z } from "zod";

export const changeMyPasswordSchema = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
});

export type ChangeMyPasswordInput = z.infer<typeof changeMyPasswordSchema>;
