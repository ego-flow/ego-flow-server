import type { VideoRecord } from "#/api/videos";
import { VIDEO_SNAPSHOT_STORAGE_KEY } from "#/constants/storage/storage-constants";
import { readSessionJson, writeSessionJson } from "#/utils/storage";

function readSnapshotMap() {
	return readSessionJson<Record<string, VideoRecord>>(
		VIDEO_SNAPSHOT_STORAGE_KEY,
		{},
	);
}

function writeSnapshotMap(value: Record<string, VideoRecord>) {
	writeSessionJson(VIDEO_SNAPSHOT_STORAGE_KEY, value);
}

export function saveVideoSnapshot(video: VideoRecord) {
	const nextSnapshots = readSnapshotMap();
	nextSnapshots[video.id] = video;
	writeSnapshotMap(nextSnapshots);
}

export function removeVideoSnapshot(videoId: string) {
	const nextSnapshots = readSnapshotMap();
	delete nextSnapshots[videoId];
	writeSnapshotMap(nextSnapshots);
}
