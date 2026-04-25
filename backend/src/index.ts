import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import type { NextFunction, Request, Response } from "express";
import swaggerUi from "swagger-ui-express";

import { runtimeConfig as env } from "./config/runtime";
import { openApiDocument } from "./docs/openapi";
import { AppError } from "./lib/errors";
import { redis } from "./lib/redis";
import { getServerInfo } from "./lib/server-info";
import { getTargetDirectory, initializeTargetDirectory } from "./lib/storage";
import { errorMiddleware } from "./middleware/error.middleware";
import { requireSignedFileAccess } from "./middleware/signed-file-access.middleware";
import { authRoutes } from "./routes/auth.routes";
import { adminRoutes } from "./routes/admin.routes";
import { hlsAuthRoutes } from "./routes/hls-auth.routes";
import { hooksRoutes } from "./routes/hooks.routes";
import { liveStreamsRoutes } from "./routes/live-streams.routes";
import { recordingsRoutes } from "./routes/recordings.routes";
import { repositoryVideosRoutes } from "./routes/repository-videos.routes";
import { repositoriesRoutes } from "./routes/repositories.routes";
import { streamsRoutes } from "./routes/streams.routes";
import { usersRoutes } from "./routes/users.routes";
import { streamService } from "./services/stream.service";

const app = express();

app.set("trust proxy", true);
app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
    credentials: true,
  }),
);
app.use(morgan("dev"));
app.use(express.json());

app.get("/api/v1/openapi.json", (_req, res) => {
  res.status(200).json(openApiDocument);
});

app.use(
  "/api-docs",
  (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline';",
    );
    next();
  },
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    explorer: true,
    customSiteTitle: "EgoFlow API Docs",
  }),
);

app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/v1/info", (_req, res) => {
  res.status(200).json(getServerInfo());
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/repositories/:repoId/videos", repositoryVideosRoutes);
app.use("/api/v1/repositories", repositoriesRoutes);
app.use("/api/v1/live-streams", liveStreamsRoutes);
app.use("/api/v1/hls-auth", hlsAuthRoutes);
app.use("/api/v1/streams", streamsRoutes);
app.use("/api/v1/hooks", hooksRoutes);
app.use("/api/v1/recordings", recordingsRoutes);
app.use("/api/v1/users", usersRoutes);
app.use(
  "/files",
  (_req, res, next) => {
    // Keep file responses embeddable whether the dashboard is same-origin behind the proxy or served elsewhere.
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  requireSignedFileAccess,
  (req, res, next) =>
    express.static(getTargetDirectory(), {
      dotfiles: "allow",
      fallthrough: true,
      index: false,
      redirect: false,
    })(req, res, next),
);

app.use((_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "Route not found."));
});
app.use(errorMiddleware);

const start = async () => {
  console.log("[startup] initializing target directory");
  await initializeTargetDirectory();
  console.log("[startup] target directory ready");
  console.log("[startup] runtime playback config", {
    publicHttpPort: env.PUBLIC_HTTP_PORT,
    rtmpPort: env.RTMP_PORT,
    rtmpsPort: env.RTMPS_PORT,
    rtmpsEnabled: env.RTMPS_ENABLED,
    rtmpsEncryptionMode: env.RTMPS_ENCRYPTION_MODE,
    rtmpsCertPath: env.RTMPS_CERT_PATH,
    rtmpsKeyPath: env.RTMPS_KEY_PATH,
    hlsPort: env.HLS_PORT,
    mediamtxApiPort: env.MEDIAMTX_API_PORT,
    rtmpBaseUrl: env.RTMP_BASE_URL,
    hlsPathPrefix: env.HLS_PATH_PREFIX,
    mediamtxApiUrl: env.MEDIAMTX_API_URL,
  });
  console.log("[startup] starting reconcile loop");
  streamService.startReconcileLoop();
  console.log("[startup] reconcile loop started");

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(env.PORT, "0.0.0.0", () => {
      console.log(`EgoFlow backend listening on port ${env.PORT}`);
      resolve();
    });

    server.on("error", reject);
  });
};

void start().catch((error) => {
  console.error("Failed to start EgoFlow backend:", error);
  process.exit(1);
});

void redis;
