import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env";
import { AppError } from "./lib/errors";
import { redis } from "./lib/redis";
import { getTargetDirectory, initializeTargetDirectory } from "./lib/storage";
import { requireAuthWithQueryToken } from "./middleware/auth.middleware";
import { errorMiddleware } from "./middleware/error.middleware";
import { requireFileAccess } from "./middleware/file-access.middleware";
import { authRoutes } from "./routes/auth.routes";
import { adminRoutes } from "./routes/admin.routes";
import { hooksRoutes } from "./routes/hooks.routes";
import { repositoriesRoutes } from "./routes/repositories.routes";
import { streamsRoutes } from "./routes/streams.routes";
import { usersRoutes } from "./routes/users.routes";
import { videosRoutes } from "./routes/videos.routes";

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
  }),
);
app.use(morgan("dev"));
app.use(express.json());

app.get("/api/v1/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/admin", adminRoutes);
app.use("/api/v1/repositories", repositoriesRoutes);
app.use("/api/v1/streams", streamsRoutes);
app.use("/api/v1/hooks", hooksRoutes);
app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/videos", videosRoutes);
app.use(
  "/files",
  (_req, res, next) => {
    // Dashboard runs on a different origin (:8088) and embeds media from the backend (:3000).
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  requireAuthWithQueryToken,
  requireFileAccess,
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
  await initializeTargetDirectory();

  app.listen(env.PORT, () => {
    console.log(`EgoFlow backend listening on port ${env.PORT}`);
  });
};

void start().catch((error) => {
  console.error("Failed to start EgoFlow backend:", error);
  process.exit(1);
});

void redis;
