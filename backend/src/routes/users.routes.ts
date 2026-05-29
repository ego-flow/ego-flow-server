import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { getAuthUser } from "../lib/request-context";
import { requireDashboardSession } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import { changeMyPasswordSchema } from "../schemas/user.schema";
import { authService } from "../services/auth.service";

const router = Router();

// PUT /api/v1/users/me/password
router.put(
  "/me/password",
  requireDashboardSession,
  validate(changeMyPasswordSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await authService.changeMyPassword(user.userId, req.body);
    res.status(200).json(response);
  }),
);

export const usersRoutes = router;
