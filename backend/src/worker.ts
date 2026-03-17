import { createVideoProcessingWorker } from "./workers/video-processing.worker";

const worker = createVideoProcessingWorker();

console.log("EgoFlow worker started");

const shutdown = async (signal: string) => {
  console.log(`[worker] received ${signal}, shutting down...`);
  await worker.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
