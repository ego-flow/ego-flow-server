import fs from "fs/promises";
import path from "path";

import ffmpeg from "fluent-ffmpeg";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const ffmpegPath = typeof ffmpegStatic === "string" ? ffmpegStatic : null;
if (!ffmpegPath) {
  throw new Error("ffmpeg-static binary path could not be resolved.");
}
ffmpeg.setFfmpegPath(ffmpegPath);
if (ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

const run = (command: ffmpeg.FfmpegCommand): Promise<void> =>
  new Promise((resolve, reject) => {
    command
      .on("end", () => resolve())
      .on("error", (error) => reject(error))
      .run();
  });

export interface EncodedOutputPaths {
  vlmVideoPath: string;
  dashboardVideoPath: string;
  thumbnailPath: string;
}

export const buildOutputPaths = (
  targetDirectory: string,
  userId: string,
  videoKey: string,
  videoId: string,
): EncodedOutputPaths => {
  const shortId = videoId.slice(0, 8);
  const baseName = `${videoKey}_${shortId}`;
  const userRoot = path.join(targetDirectory, userId);

  return {
    vlmVideoPath: path.join(userRoot, "vlm", `${baseName}.mp4`),
    dashboardVideoPath: path.join(userRoot, "dashboard", `${baseName}.mp4`),
    thumbnailPath: path.join(userRoot, "thumbnails", `${baseName}.jpg`),
  };
};

export const ensureOutputDirectories = async (outputs: EncodedOutputPaths) => {
  await Promise.all([
    fs.mkdir(path.dirname(outputs.vlmVideoPath), { recursive: true }),
    fs.mkdir(path.dirname(outputs.dashboardVideoPath), { recursive: true }),
    fs.mkdir(path.dirname(outputs.thumbnailPath), { recursive: true }),
  ]);
};

export const encodeVlmVideo = async (inputPath: string, outputPath: string) => {
  const command = ffmpeg(inputPath)
    .videoCodec("libx264")
    .audioCodec("aac")
    .outputOptions([
      "-profile:v baseline",
      "-preset veryfast",
      "-crf 23",
      "-pix_fmt yuv420p",
      "-movflags +faststart",
    ])
    .output(outputPath);

  await run(command);
};

export const encodeDashboardVideo = async (inputPath: string, outputPath: string) => {
  const command = ffmpeg(inputPath)
    .videoCodec("libx264")
    .audioCodec("aac")
    .outputOptions([
      "-profile:v main",
      "-preset fast",
      "-crf 23",
      "-pix_fmt yuv420p",
      "-movflags +faststart",
    ])
    .output(outputPath);

  await run(command);
};

export const encodeThumbnail = async (inputPath: string, outputPath: string, seekSeconds: number) => {
  const command = ffmpeg(inputPath)
    .seekInput(Math.max(seekSeconds, 0))
    .frames(1)
    .outputOptions(["-vf scale=320:-1"])
    .output(outputPath);

  await run(command);
};
