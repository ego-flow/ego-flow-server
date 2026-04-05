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

/**
 * [출력 경로 생성]
 * targetDirectory/{ownerId}/{repoName}/ 하위에 VLM 비디오, 대시보드 비디오, 썸네일 경로를 생성한다.
 */
export const buildOutputPaths = (
  targetDirectory: string,
  ownerId: string,
  repoName: string,
  videoId: string,
): EncodedOutputPaths => {
  const repositoryRoot = path.join(targetDirectory, ownerId, repoName);

  return {
    vlmVideoPath: path.join(repositoryRoot, `${videoId}.mp4`),
    dashboardVideoPath: path.join(repositoryRoot, ".dashboard", `${videoId}.mp4`),
    thumbnailPath: path.join(repositoryRoot, ".thumbnails", `${videoId}.jpg`),
  };
};

/** [출력 디렉토리 생성] VLM, 대시보드, 썸네일 경로의 부모 디렉토리를 재귀적으로 생성한다. */
export const ensureOutputDirectories = async (outputs: EncodedOutputPaths) => {
  await Promise.all([
    fs.mkdir(path.dirname(outputs.vlmVideoPath), { recursive: true }),
    fs.mkdir(path.dirname(outputs.dashboardVideoPath), { recursive: true }),
    fs.mkdir(path.dirname(outputs.thumbnailPath), { recursive: true }),
  ]);
};

/**
 * [VLM용 비디오 인코딩]
 * baseline H.264 + AAC로 인코딩. Python 라이브러리나 VLM에서 사용하는 데이터셋 비디오.
 */
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

/**
 * [대시보드용 비디오 인코딩]
 * main H.264 + AAC로 인코딩. 웹 대시보드에서 재생하는 용도.
 */
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

/** [썸네일 생성] 비디오 중간 지점에서 320px 너비의 프레임 1장을 추출한다. */
export const encodeThumbnail = async (inputPath: string, outputPath: string, seekSeconds: number) => {
  const command = ffmpeg(inputPath)
    .seekInput(Math.max(seekSeconds, 0))
    .frames(1)
    .outputOptions(["-vf scale=320:-1"])
    .output(outputPath);

  await run(command);
};

/**
 * [세그먼트 병합]
 * 2개 이상의 녹화 세그먼트를 ffmpeg concat demuxer로 무재인코딩 병합한다.
 * 병합된 파일은 .tmp/{sessionId}/merged.mp4에 생성된다.
 */
export const concatSegments = async (
  segmentPaths: string[],
  concatListPath: string,
  outputPath: string,
): Promise<void> => {
  const concatContent = segmentPaths.map((p) => `file '${p}'`).join("\n");
  await fs.writeFile(concatListPath, concatContent, "utf-8");
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const command = ffmpeg(concatListPath)
    .inputOptions(["-f concat", "-safe 0"])
    .outputOptions(["-c copy", "-movflags +faststart"])
    .output(outputPath);

  await run(command);
};
