import ffmpeg from "fluent-ffmpeg";
import ffprobeStatic from "ffprobe-static";

interface ProbeVideoMetadata {
  durationSec: number | null;
  resolutionWidth: number | null;
  resolutionHeight: number | null;
  fps: number | null;
  codec: string | null;
  recordedAt: Date | null;
}

const parseFps = (value: string | undefined): number | null => {
  if (!value) {
    return null;
  }
  if (!value.includes("/")) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const [numRaw, denRaw] = value.split("/");
  const numerator = Number(numRaw);
  const denominator = Number(denRaw);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }
  return numerator / denominator;
};

const parseDate = (value: string | number | undefined): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const probeAsync = (filePath: string): Promise<ffmpeg.FfprobeData> =>
  new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (error, metadata) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(metadata);
    });
  });

if (ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
}

export const probeVideoMetadata = async (filePath: string): Promise<ProbeVideoMetadata> => {
  const metadata = await probeAsync(filePath);
  const videoStream = metadata.streams?.find((stream) => stream.codec_type === "video");

  const durationSecRaw = Number(metadata.format?.duration);
  const durationSec = Number.isFinite(durationSecRaw) && durationSecRaw > 0 ? durationSecRaw : null;

  const resolutionWidth =
    typeof videoStream?.width === "number" && Number.isFinite(videoStream.width)
      ? videoStream.width
      : null;
  const resolutionHeight =
    typeof videoStream?.height === "number" && Number.isFinite(videoStream.height)
      ? videoStream.height
      : null;

  const fps = parseFps(videoStream?.avg_frame_rate || videoStream?.r_frame_rate);
  const codec = videoStream?.codec_name || null;
  const recordedAt =
    parseDate(metadata.format?.tags?.creation_time) ||
    parseDate(videoStream?.tags?.creation_time) ||
    null;

  return {
    durationSec,
    resolutionWidth,
    resolutionHeight,
    fps,
    codec,
    recordedAt,
  };
};
