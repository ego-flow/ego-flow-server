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
