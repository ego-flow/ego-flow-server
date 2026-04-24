import { runtimeConfig as env } from "../config/runtime";

export const getServerInfo = () => ({
  api_version: "v1",
  server_version: "0.1.0",
  capabilities: {
    dataset_manifest: true,
    video_download: true,
    thumbnail_download: true,
    live_streams: false,
    python_tokens: true,
  },
  urls: {
    api_base: "/api/v1",
    hls_base: env.HLS_BASE_URL,
  },
});
