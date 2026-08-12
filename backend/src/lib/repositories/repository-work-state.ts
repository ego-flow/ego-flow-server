import { recordingSegmentRepository } from "../../repositories/recording-segment.repository";
import { recordingSessionRepository } from "../../repositories/recording-session.repository";
import { Conflict } from "../core/errors";

export interface RepositoryPermanentDeleteState {
  activeStreamingSessionCount: number;
  finalizingSegmentCount: number;
  canDelete: boolean;
}

export const getRepositoryPermanentDeleteState = async (
  repositoryId: string,
): Promise<RepositoryPermanentDeleteState> => {
  const [activeStreamingSessionCount, finalizingSegmentCount] = await Promise.all([
    recordingSessionRepository.countStreamingByRepositoryId(repositoryId),
    recordingSegmentRepository.countFinalizingByRepositoryId(repositoryId),
  ]);

  return {
    activeStreamingSessionCount,
    finalizingSegmentCount,
    canDelete:
      activeStreamingSessionCount === 0 &&
      finalizingSegmentCount === 0,
  };
};

export const assertRepositoryPermanentlyDeletable = (
  state: RepositoryPermanentDeleteState,
): void => {
  if (state.activeStreamingSessionCount > 0 || state.finalizingSegmentCount > 0) {
    throw Conflict(
      "Repository cannot be permanently deleted while streams or recording finalization are active.",
    );
  }
};

export const assertRepositoryIsIdle = async (
  repositoryId: string,
  options: { blockPending?: boolean } = { blockPending: true },
): Promise<void> => {
  const activeSession = await recordingSessionRepository.hasOpenSessionByRepositoryId({
    repositoryId,
    blockPending: options.blockPending ?? true,
  });

  if (activeSession) {
    throw Conflict("Repository cannot be modified while a stream is active.");
  }

  const finalizingSegment = await recordingSegmentRepository.hasFinalizingByRepositoryId(repositoryId);

  if (finalizingSegment) {
    throw Conflict("Repository cannot be modified while recording finalization is in progress.");
  }
};
