import { z } from "zod";

export const loginSchema = z.object({
  id: z.string().min(1).max(64),
  password: z.string(),
});

export const dashboardLoginSchema = loginSchema.extend({
  remember_me: z.boolean().optional().default(false),
});

export const issuePythonTokenSchema = loginSchema.extend({
  name: z.string().trim().min(1).max(100),
});

const optionalString = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  return value;
}, z.string().optional());

const optionalCredential = z.preprocess((value) => {
  if (value === "" || value === null || value === undefined) {
    return undefined;
  }

  return value;
}, z.string().min(1).optional());

export const publishAuthSchema = z.object({
  user: z.preprocess((value) => {
    if (value === "" || value === null || value === undefined) {
      return undefined;
    }

    return value;
  }, z.string().min(1).max(64).optional()),
  password: optionalCredential,
  token: optionalCredential,
  action: z.string().min(1),
  path: z.string().min(1),
  protocol: optionalString,
  query: optionalString,
  id: optionalString,
  ip: optionalString,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type DashboardLoginInput = z.infer<typeof dashboardLoginSchema>;
export type IssuePythonTokenInput = z.infer<typeof issuePythonTokenSchema>;
export type PublishAuthInput = z.infer<typeof publishAuthSchema>;
