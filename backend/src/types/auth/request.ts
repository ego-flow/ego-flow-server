import type { z } from "zod";

import type {
  dashboardLoginSchema,
  issuePythonTokenSchema,
  loginSchema,
  mediaMtxAuthSchema,
} from "../../schemas/auth.schema";
import type { pythonTokenIdParamSchema } from "../../schemas/python-token.schema";
import type { changeMyPasswordSchema } from "../../schemas/user.schema";

export type LoginInput = z.infer<typeof loginSchema>;
export type DashboardLoginInput = z.infer<typeof dashboardLoginSchema>;
export type IssuePythonTokenInput = z.infer<typeof issuePythonTokenSchema>;
export type MediaMtxAuthInput = z.infer<typeof mediaMtxAuthSchema>;
export type ChangeMyPasswordInput = z.infer<typeof changeMyPasswordSchema>;
export type PythonTokenIdParamInput = z.infer<typeof pythonTokenIdParamSchema>;

export type CreatePythonTokenInput = {
  name: string;
};
