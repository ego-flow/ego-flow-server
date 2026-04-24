import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { AppError } from "../lib/errors";
import { requireDashboardSession } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { changeMyPasswordSchema } from "../schemas/user.schema";
import { authService } from "../services/auth.service";

const router = Router();

router.put(
  "/me/password",
  requireDashboardSession,
  validate(changeMyPasswordSchema),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }
    const response = await authService.changeMyPassword(req.user.userId, req.body);
    res.status(200).json(response);
  }),
);

export const usersRoutes = router;
