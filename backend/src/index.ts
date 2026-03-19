import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";

import { env } from "./config/env";
import { AppError } from "./lib/errors";
import { redis } from "./lib/redis";
import { getTargetDirectory } from "./lib/storage";
import { requireAuthWithQueryToken } from "./middleware/auth.middleware";
import { errorMiddleware } from "./middleware/error.middleware";
import { requireFileAccess } from "./middleware/file-access.middleware";
import { authRoutes } from "./routes/auth.routes";
import { hooksRoutes } from "./routes/hooks.routes";
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
app.use("/api/v1/streams", streamsRoutes);
app.use("/api/v1/hooks", hooksRoutes);
app.use("/api/v1/users", usersRoutes);
app.use("/api/v1/videos", videosRoutes);
app.use("/files", requireAuthWithQueryToken, requireFileAccess, (req, res, next) => {
  void getTargetDirectory()
    .then((targetDirectory) =>
      express.static(targetDirectory, {
        dotfiles: "deny",
        fallthrough: true,
        index: false,
        redirect: false,
      })(req, res, next),
    )
    .catch(next);
});

app.use((_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "Route not found."));
});
app.use(errorMiddleware);

app.listen(env.PORT, () => {
  console.log(`EgoFlow backend listening on port ${env.PORT}`);
});

void redis;
