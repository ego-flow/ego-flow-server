export const getServerInfo = () => ({
  api_version: "v1",
  server_version: "0.1.0",
  capabilities: {
    dataset_manifest: true,
    video_download: true,
    thumbnail_download: true,
    live_streams: true,
    python_tokens: true,
  },
});
