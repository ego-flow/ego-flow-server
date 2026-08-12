import { createRecordingFinalizeWorker } from "./workers/recording-finalize.worker";

const finalizeWorker = createRecordingFinalizeWorker();

console.log("EgoFlow workers started (recording-finalize)");

const shutdown = async (signal: string) => {
  console.log(`[worker] received ${signal}, shutting down...`);
  await finalizeWorker.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
