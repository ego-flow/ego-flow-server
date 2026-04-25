import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { clearDashboardSessionCookie, setDashboardSessionCookie } from "../lib/dashboard-session-cookie";
import { AppError } from "../lib/errors";
import { requireDashboardOrAppOrPython, requireDashboardSession } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import type { ApiTokenIdParamInput } from "../schemas/api-token.schema";
import { apiTokenIdParamSchema, createApiTokenSchema } from "../schemas/api-token.schema";
import { dashboardLoginSchema, loginSchema, rtmpAuthSchema } from "../schemas/auth.schema";
import { apiTokenService } from "../services/api-token.service";
import { authService } from "../services/auth.service";
import { dashboardSessionService } from "../services/dashboard-session.service";

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
  "/app/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const response = await authService.login(req.body);
    res.status(200).json(response);
  }),
);

router.post(
  "/dashboard/login",
  validate(dashboardLoginSchema),
  asyncHandler(async (req, res) => {
    const response = await authService.loginDashboard(req.body);
    setDashboardSessionCookie(req, res, response.session.token, {
      persistent: response.session.persistent,
      expiresAt: response.session.expiresAt,
    });
    res.status(200).json({ user: response.user });
  }),
);

router.post(
  "/dashboard/logout",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    if (req.auth?.kind === "dashboard" && req.auth.rawCredential) {
      await dashboardSessionService.revokeSession(req.auth.rawCredential);
    }
    clearDashboardSessionCookie(req, res);
    res.status(200).json({ logged_out: true });
  }),
);

router.get(
  "/dashboard/session",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    res.status(200).json({
      user: {
        id: req.user.userId,
        role: req.user.role,
        display_name: req.user.displayName,
      },
    });
  }),
);

router.post(
  "/tokens",
  requireDashboardSession,
  validate(createApiTokenSchema),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const response = await apiTokenService.issueToken(req.user.userId, req.body);
    res.status(201).json(response);
  }),
);

router.get(
  "/tokens",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const token = await apiTokenService.getCurrentToken(req.user.userId);
    res.status(200).json({ token });
  }),
);

router.get(
  "/validate",
  requireDashboardOrAppOrPython,
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    res.status(200).json({
      user: {
        id: req.user.userId,
        role: req.user.role,
        display_name: req.user.displayName,
      },
      auth: {
        kind: req.auth?.kind ?? null,
      },
    });
  }),
);

router.delete(
  "/tokens/:tokenId",
  requireDashboardSession,
  validate(apiTokenIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    if (!req.user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication is required.");
    }

    const tokenId = (req.params as ApiTokenIdParamInput).tokenId;
    await apiTokenService.revokeToken(req.user.userId, req.user.role, tokenId);
    res.status(200).json({
      id: tokenId,
      revoked: true,
    });
  }),
);

/**
 * [RTMP 인증 엔드포인트]
 * MediaMTX의 authHTTPAddress로 설정되어 있어, publish/read 시도 시 MediaMTX가 자동 호출한다.
 * - publish: RTMP URL의 query에 포함된 JWT와 user 정보로 인증하고, 세션 소유자 일치 여부 확인
 * - read/playback: JWT 인증 후 repository read 권한 확인
 * 200이면 허용, 401이면 거부.
 */
router.post(
  "/rtmp",
  asyncHandler(async (req, res) => {
    const parsed = rtmpAuthSchema.safeParse(req.body);
    if (!parsed.success) {
      console.warn("[rtmp-auth] invalid payload", {
        action: req.body?.action,
        path: req.body?.path,
        protocol: req.body?.protocol,
        user: req.body?.user,
        id: req.body?.id,
        ip: req.body?.ip,
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          code: issue.code,
          message: issue.message,
        })),
      });
      res.status(401).end();
      return;
    }

    const isAuthorized = await authService.verifyRtmpAuthorization(parsed.data);
    if (!isAuthorized) {
      res.status(401).end();
      return;
    }

    res.status(200).end();
  }),
);

export const authRoutes = router;
