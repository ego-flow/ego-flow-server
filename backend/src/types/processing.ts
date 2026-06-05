export const RECORDING_FINALIZE_STEPS = [
  { task: "initialize_video", label: "Initialize video" },
  { task: "stabilize_raw", label: "Stabilize raw" },
  { task: "probe_metadata", label: "Probe metadata" },
  { task: "prepare_outputs", label: "Prepare outputs" },
  { task: "encode_assets", label: "Encode assets" },
  { task: "verify_artifact", label: "Verify artifact" },
  { task: "persist_video", label: "Persist video" },
] as const;

export type RecordingFinalizeTask = (typeof RECORDING_FINALIZE_STEPS)[number]["task"];

export type RecordingFinalizeProgress = {
  current_step: number;
  total_steps: number;
  task: RecordingFinalizeTask;
  label: string;
};

export const buildRecordingFinalizeProgress = (
  task: RecordingFinalizeTask,
): RecordingFinalizeProgress => {
  const stepIndex = RECORDING_FINALIZE_STEPS.findIndex((step) => step.task === task);
  const step = RECORDING_FINALIZE_STEPS[stepIndex];

  if (!step) {
    throw new Error(`Unknown recording finalize task: ${task}`);
  }

  return {
    current_step: stepIndex + 1,
    total_steps: RECORDING_FINALIZE_STEPS.length,
    task: step.task,
    label: step.label,
  };
};

export const RECORDING_FINALIZE_COMPLETED_PROGRESS = buildRecordingFinalizeProgress("persist_video");

export const parseRecordingFinalizeProgress = (value: unknown): RecordingFinalizeProgress | null => {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<RecordingFinalizeProgress>;
  const matchingStep = RECORDING_FINALIZE_STEPS.find((step) => step.task === candidate.task);
  if (!matchingStep) {
    return null;
  }

  const currentStep = Number(candidate.current_step);
  const totalSteps = Number(candidate.total_steps);
  if (
    !Number.isInteger(currentStep) ||
    !Number.isInteger(totalSteps) ||
    totalSteps !== RECORDING_FINALIZE_STEPS.length ||
    currentStep < 1 ||
    currentStep > totalSteps
  ) {
    return null;
  }

  return {
    current_step: currentStep,
    total_steps: totalSteps,
    task: matchingStep.task,
    label: typeof candidate.label === "string" && candidate.label.trim() ? candidate.label : matchingStep.label,
  };
};
