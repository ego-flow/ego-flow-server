import { z } from "zod";

export const changeMyPasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(255),
});

export type ChangeMyPasswordInput = z.infer<typeof changeMyPasswordSchema>;
