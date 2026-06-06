import { Router } from "express";

import { asyncHandler } from "../lib/async-handler";
import { clearDashboardSessionCookie, setDashboardSessionCookie } from "../lib/auth/dashboard-cookie";
import { getAuthUser } from "../lib/request-context";
import { requireDashboardSession, requirePythonToken } from "../middleware/auth.middleware";
import { validate } from "../middleware/validate.middleware";
import type { PythonTokenIdParamInput } from "../schemas/python-token.schema";
import { pythonTokenIdParamSchema } from "../schemas/python-token.schema";
import { dashboardLoginSchema, issuePythonTokenSchema, loginSchema } from "../schemas/auth.schema";
import { changeMyPasswordSchema } from "../schemas/user.schema";
import { authService } from "../services/auth.service";

const router = Router();

// POST /api/v1/auth/app/login
router.post(
  "/app/login",
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const response = await authService.loginApp(req.body);
    res.status(200).json(response);
  }),
);

// POST /api/v1/auth/dashboard/login
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

// POST /api/v1/auth/dashboard/logout
router.post(
  "/dashboard/logout",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    const response = await authService.logoutDashboard(req.auth);
    clearDashboardSessionCookie(req, res);
    res.status(200).json(response);
  }),
);

// GET /api/v1/auth/dashboard/session
router.get(
  "/dashboard/session",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    const response = authService.getDashboardSession(getAuthUser(req));
    res.status(200).json(response);
  }),
);

// PUT /api/v1/auth/dashboard/me/password
router.put(
  "/dashboard/me/password",
  requireDashboardSession,
  validate(changeMyPasswordSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await authService.changeDashboardPassword(user.userId, req.body);
    res.status(200).json(response);
  }),
);

// POST /api/v1/auth/python/tokens
router.post(
  "/python/tokens",
  requireDashboardSession,
  validate(issuePythonTokenSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const response = await authService.issuePythonToken(user.userId, req.body);
    res.status(201).json(response);
  }),
);

// GET /api/v1/auth/python/tokens
router.get(
  "/python/tokens",
  requireDashboardSession,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const token = await authService.getCurrentPythonToken(user.userId);
    res.status(200).json({ token });
  }),
);

// GET /api/v1/auth/python/tokens/validate
router.get(
  "/python/tokens/validate",
  requirePythonToken,
  asyncHandler(async (req, res) => {
    const response = authService.validatePythonToken(getAuthUser(req));
    res.status(200).json(response);
  }),
);

// DELETE /api/v1/auth/python/tokens/:tokenId
router.delete(
  "/python/tokens/:tokenId",
  requireDashboardSession,
  validate(pythonTokenIdParamSchema, "params"),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const tokenId = (req.params as PythonTokenIdParamInput).tokenId;
    await authService.revokePythonToken(user.userId, user.role, tokenId);
    res.status(200).json({
      id: tokenId,
      revoked: true,
    });
  }),
);

const handleMediaMtxAuth = asyncHandler(async (req, res) => {
  const isAuthorized = await authService.authorizeMediaMtxRequest(req.body);
  if (!isAuthorized) {
    res.status(401).end();
    return;
  }

  res.status(200).end();
});

/**
 * [MediaMTX 인증 엔드포인트]
 * MediaMTX authHTTPAddress로 설정되어 publish/read action을 공통 수신한다.
 * - publish: query.ticket 기반 publish ticket만 허용한다.
 * - read + hls: playback ticket만 허용한다.
 * MediaMTX는 단순 status code(200/401)만 보므로 의도적으로 빈 응답을 돌려준다.
 */
// POST /api/v1/auth/mediamtx
router.post("/mediamtx", handleMediaMtxAuth);

export const authRoutes = router;
