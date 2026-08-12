export const RECORDING_FINALIZE_STEPS = [
  { task: "initialize_video", label: "Initialize video" },
  { task: "stabilize_raw", label: "Stabilize raw" },
  { task: "probe_metadata", label: "Probe metadata" },
  { task: "prepare_outputs", label: "Prepare outputs" },
  { task: "encode_assets", label: "Encode assets" },
  { task: "verify_artifact", label: "Verify artifact" },
  { task: "persist_video", label: "Persist video" },
] as const;
