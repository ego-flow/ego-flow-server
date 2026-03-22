import { z } from "zod";

export const loginSchema = z.object({
  id: z.string().min(1).max(64),
  password: z.string().min(1).max(255),
});

export const rtmpAuthSchema = z.object({
  user: z.string().min(1).max(64),
  password: z.string().min(1),
  token: z.string().min(1).optional(),
  action: z.string().min(1),
  path: z.string().min(1),
  protocol: z.string().optional(),
  query: z.string().optional(),
  id: z.string().optional(),
  ip: z.string().optional(),
}).partial({
  user: true,
  password: true,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RtmpAuthInput = z.infer<typeof rtmpAuthSchema>;
