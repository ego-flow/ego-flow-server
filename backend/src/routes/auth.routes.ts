import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { validate } from "../middleware/validate.middleware";
import { loginSchema, rtmpAuthSchema } from "../schemas/auth.schema";
import { authService } from "../services/auth.service";

const router = Router();

router.post(
  "/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const response = await authService.login(req.body);
    res.status(200).json(response);
  }),
);

router.post(
  "/rtmp",
  asyncHandler(async (req, res) => {
    const parsed = rtmpAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(401).end();
      return;
    }

    const isAuthorized = authService.verifyRtmpAuthorization(parsed.data);
    if (!isAuthorized) {
      res.status(401).end();
      return;
    }

    res.status(200).end();
  }),
);

export const authRoutes = router;
