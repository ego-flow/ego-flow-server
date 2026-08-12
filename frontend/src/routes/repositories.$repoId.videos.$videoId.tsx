import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Download, Trash2 } from "lucide-react";
import { useState } from "react";
import { getApiErrorMessage } from "#/api/client";
import {
	requestDeleteVideo,
	requestVideoDetail,
	requestVideoDownload,
	requestVideoStatus,
	VideoSemanticMetadataStatus,
	type VideoSemanticMetadata,
	type VideoProcessingProgress,
} from "#/api/videos";
import { ConfirmDialog } from "#/components/ConfirmDialog";
import { Button } from "#/components/ui/button";
import { VideoStatus } from "#/constants/video/video-constants";
import {
	formatBytes,
	formatDateTime,
	formatDuration,
	formatResolution,
} from "#/lib/format";
import { removeVideoSnapshot } from "#/lib/video-snapshots";
import { videoStatusClassName } from "#/utils/class-names";
import { contributorDisplayName, repositoryDisplayName } from "#/utils/display";

export const Route = createFileRoute("/repositories/$repoId/videos/$videoId")({
	component: RepositoryVideoDetailPage,
});

type DetailPanelTab = "metadata" | "semantics";

function formatSemanticJsonValue(value: unknown) {
	if (
		value === null ||
		typeof value === "undefined" ||
		(Array.isArray(value) && value.length === 0)
	) {
		return "None";
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "Unavailable";
	}
}

function formatSemanticTextValue(value: string | null | undefined) {
	const trimmed = value?.trim();
	return trimmed || "None";
}

function formatSemanticDateTime(value: string | null | undefined) {
	return value ? formatDateTime(value) : "None";
}

function formatSemanticStatus(
	status: VideoSemanticMetadata["status"] | null | undefined,
) {
	switch (status ?? VideoSemanticMetadataStatus.Pending) {
		case VideoSemanticMetadataStatus.Processing:
			return "Processing";
		case VideoSemanticMetadataStatus.Completed:
			return "Completed";
		case VideoSemanticMetadataStatus.Failed:
			return "Failed";
		case VideoSemanticMetadataStatus.Pending:
		default:
			return "Pending";
	}
}

function ProcessingProgressIndicator({
	progress,
}: {
	progress: VideoProcessingProgress | null;
}) {
	const currentStep = progress?.currentStep ?? 0;
	const totalSteps = progress?.totalSteps ?? 0;
	const ratio = totalSteps > 0 ? Math.min(1, Math.max(0, currentStep / totalSteps)) : 0;
	const degrees = Math.round(ratio * 360);

	return (
		<div className="mt-4 flex min-w-0 items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-3 text-sm">
			<div
				className="grid size-11 shrink-0 place-items-center rounded-full"
				style={{
					background: `conic-gradient(var(--lagoon-deep) ${degrees}deg, var(--line) ${degrees}deg)`,
				}}
				aria-hidden="true"
			>
				<div className="grid size-8 place-items-center rounded-full bg-[var(--card)] text-[11px] font-semibold text-[var(--sea-ink)]">
					{totalSteps > 0 ? `${currentStep}/${totalSteps}` : "..."}
				</div>
			</div>
			<div className="min-w-0">
				<div className="truncate font-semibold text-[var(--sea-ink)]">
					{progress?.label ?? "Processing"}
				</div>
				<div className="text-xs text-[var(--sea-ink-soft)]">
					Video processing
				</div>
			</div>
		</div>
	);
}

function RepositoryVideoDetailPage() {
	const { repoId, videoId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const repositorySearch = useSearch({ from: "/repositories/$repoId" });
	const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
	const [selectedDetailTab, setSelectedDetailTab] =
		useState<DetailPanelTab>("metadata");

	const detailQuery = useQuery({
		queryKey: ["video-detail", repoId, videoId],
		queryFn: () => requestVideoDetail(repoId, videoId),
	});

	const statusQuery = useQuery({
		queryKey: ["video-status", repoId, videoId],
		queryFn: () => requestVideoStatus(repoId, videoId),
	});

	const deleteMutation = useMutation({
		mutationFn: () => requestDeleteVideo(repoId, videoId),
		onSuccess: async () => {
			setIsDeleteConfirmOpen(false);
			removeVideoSnapshot(videoId);
			await queryClient.invalidateQueries({
				queryKey: ["videos", "repository", repoId],
			});
			await navigate({
				to: "/repositories/$repoId",
				params: { repoId },
				search: repositorySearch,
			});
		},
	});

	const downloadMutation = useMutation({
		mutationFn: async () => {
			return requestVideoDownload(
				repoId,
				videoId,
				detailQuery.data?.repositoryName,
			);
		},
		onSuccess: ({ blob, fileName }) => {
			const objectUrl = URL.createObjectURL(blob);
			const anchor = document.createElement("a");

			anchor.href = objectUrl;
			anchor.download = fileName;
			document.body.append(anchor);
			anchor.click();
			anchor.remove();

			window.setTimeout(() => {
				URL.revokeObjectURL(objectUrl);
			}, 0);
		},
	});

	const video = detailQuery.data ?? null;
	const currentStatus =
		statusQuery.data?.status ?? detailQuery.data?.status ?? null;
	const playbackUrl = video?.dashboardVideoUrl ?? null;
	const semanticMetadata = video?.semanticMetadata ?? null;

	return (
		<main className="page-wrap px-4 py-8 sm:py-10">
			<section className="island-shell mb-6 rounded-2xl p-3 shadow-sm">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<Link
						to="/repositories/$repoId"
						params={{ repoId }}
						search={repositorySearch}
						className="inline-flex w-fit items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition-colors hover:bg-[var(--card)]"
					>
						<ArrowLeft size={16} aria-hidden="true" />
						Back to repository
					</Link>
					<div className="flex flex-wrap items-center gap-3">
						<Button
							type="button"
							variant="outline"
							disabled={
								!video ||
								currentStatus !== VideoStatus.Completed ||
								downloadMutation.isPending
							}
							onClick={() => {
								downloadMutation.mutate();
							}}
						>
							<Download size={16} aria-hidden="true" />
							{downloadMutation.isPending ? "Downloading..." : "Download"}
						</Button>
						<Button
							type="button"
							variant="destructive"
							disabled={deleteMutation.isPending}
							onClick={() => {
								setIsDeleteConfirmOpen(true);
							}}
						>
							<Trash2 size={16} aria-hidden="true" />
							Delete
						</Button>
					</div>
				</div>
			</section>

			<section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
				<article className="island-shell rounded-2xl p-5 shadow-sm">
					<div className="mb-4 flex flex-wrap items-center gap-2">
						{currentStatus ? (
							<span
								className={`rounded-full px-2.5 py-1 text-xs font-semibold ${videoStatusClassName(currentStatus)}`}
							>
								{currentStatus}
							</span>
						) : null}
					</div>
					{currentStatus === VideoStatus.Processing ? (
						<ProcessingProgressIndicator
							progress={
								statusQuery.data?.progress ??
								detailQuery.data?.processingProgress ??
								null
							}
						/>
					) : null}

					<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
						{video ? repositoryDisplayName(video) : "Video detail"}
					</h1>
					<p className="mt-2 break-all text-sm text-[var(--sea-ink-soft)]">
						{videoId}
					</p>

					<div className="mt-6 overflow-hidden rounded-2xl border border-[var(--line)] bg-black">
						{video?.dashboardVideoUrl &&
						currentStatus === VideoStatus.Completed ? (
							// biome-ignore lint/a11y/useMediaCaption: uploaded recordings do not provide caption tracks.
							<video
								key={playbackUrl}
								src={playbackUrl ?? undefined}
								controls
								playsInline
								className="aspect-video w-full"
							/>
						) : (
							<div className="grid aspect-video place-items-center px-6 text-center text-sm text-white/70">
								<div>
									<p className="font-semibold">
										Playback is not available yet.
									</p>
									<p className="mt-2">
										Completed dashboard media appears here after processing
										finishes.
									</p>
								</div>
							</div>
						)}
					</div>

					{deleteMutation.isError ? (
						<div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/6 px-4 py-3 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								deleteMutation.error,
								"Failed to delete video.",
							)}
						</div>
					) : null}

					{downloadMutation.isError ? (
						<div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/6 px-4 py-3 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								downloadMutation.error,
								"Failed to download video.",
							)}
						</div>
					) : null}

					{statusQuery.isError ? (
						<div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/6 px-4 py-3 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								statusQuery.error,
								"Failed to load processing status.",
							)}
						</div>
					) : null}

					{detailQuery.isError ? (
						<div className="mt-4 flex items-start gap-3 rounded-xl border border-red-500/25 bg-red-500/8 px-4 py-3 text-sm text-red-700 dark:text-red-300">
							<AlertTriangle
								size={18}
								aria-hidden="true"
								className="mt-0.5 shrink-0"
							/>
							<p>
								{getApiErrorMessage(
									detailQuery.error,
									"Failed to load video details.",
								)}
							</p>
						</div>
					) : null}
				</article>

				<aside>
					<section className="island-shell rounded-2xl p-5 shadow-sm">
						<div
							className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-1"
							role="tablist"
							aria-label="Video detail panel"
						>
							{[
								{ value: "metadata" as const, label: "Metadata" },
								{ value: "semantics" as const, label: "Semantics" },
							].map((tab) => (
								<button
									key={tab.value}
									type="button"
									role="tab"
									aria-selected={selectedDetailTab === tab.value}
									onClick={() => setSelectedDetailTab(tab.value)}
									className={`rounded-lg px-3 py-2 text-sm font-semibold transition-colors ${
										selectedDetailTab === tab.value
											? "bg-[var(--card)] text-[var(--sea-ink)] shadow-sm"
											: "text-[var(--sea-ink-soft)] hover:text-[var(--sea-ink)]"
									}`}
								>
									{tab.label}
								</button>
							))}
						</div>

						{selectedDetailTab === "metadata" ? (
							<dl className="mt-5 space-y-3 text-sm text-[var(--sea-ink-soft)]">
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Repository
									</dt>
									<dd>{video ? repositoryDisplayName(video) : "Unavailable"}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Video ID
									</dt>
									<dd className="break-all">{video?.id ?? videoId}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Status
									</dt>
									<dd>{currentStatus ?? "Unavailable"}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Contributor
									</dt>
									<dd>{contributorDisplayName(video)}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">Size</dt>
									<dd>{formatBytes(video?.sizeBytes ?? null)}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Duration
									</dt>
									<dd>{formatDuration(video?.durationSec ?? null)}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Resolution
									</dt>
									<dd>{video ? formatResolution(video) : "Unavailable"}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">FPS</dt>
									<dd>{video?.fps ?? "Unavailable"}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">Codec</dt>
									<dd>{video?.codec || "Unavailable"}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Recorded at
									</dt>
									<dd>{formatDateTime(video?.recordedAt ?? null)}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Created at
									</dt>
									<dd>{formatDateTime(video?.createdAt ?? null)}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Processing started
									</dt>
									<dd>
										{formatDateTime(
											statusQuery.data?.processingStartedAt ?? null,
										)}
									</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Processing completed
									</dt>
									<dd>
										{formatDateTime(
											statusQuery.data?.processingCompletedAt ?? null,
										)}
									</dd>
								</div>
							</dl>
						) : (
							<dl className="mt-5 space-y-4 text-sm text-[var(--sea-ink-soft)]">
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Semantic metadata status
									</dt>
									<dd>
										{video
											? formatSemanticStatus(semanticMetadata?.status)
											: "Unavailable"}
									</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Video ID
									</dt>
									<dd className="break-all">
										{semanticMetadata?.videoId ?? video?.id ?? videoId}
									</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Scene summary
									</dt>
									<dd className="mt-1 whitespace-pre-wrap">
										{formatSemanticTextValue(semanticMetadata?.sceneSummary)}
									</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Clip segments
									</dt>
									<dd>
										<pre className="mt-1 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-3 text-xs">
											{formatSemanticJsonValue(semanticMetadata?.clipSegments)}
										</pre>
									</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Action labels
									</dt>
									<dd>
										<pre className="mt-1 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-3 text-xs">
											{formatSemanticJsonValue(semanticMetadata?.actionLabels)}
										</pre>
									</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Video-text alignment
									</dt>
									<dd>
										<pre className="mt-1 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-3 text-xs">
											{formatSemanticJsonValue(
												semanticMetadata?.videoTextAlignment,
											)}
										</pre>
									</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Error message
									</dt>
									<dd>{formatSemanticTextValue(semanticMetadata?.errorMessage)}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Processing started
									</dt>
									<dd>
										{formatSemanticDateTime(
											semanticMetadata?.processingStartedAt,
										)}
									</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Processing completed
									</dt>
									<dd>
										{formatSemanticDateTime(
											semanticMetadata?.processingCompletedAt,
										)}
									</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Created at
									</dt>
									<dd>{formatSemanticDateTime(semanticMetadata?.createdAt)}</dd>
								</div>
								<div>
									<dt className="font-semibold text-[var(--sea-ink)]">
										Updated at
									</dt>
									<dd>{formatSemanticDateTime(semanticMetadata?.updatedAt)}</dd>
								</div>
							</dl>
						)}
					</section>
				</aside>
			</section>
			<ConfirmDialog
				open={isDeleteConfirmOpen}
				title="Delete video"
				description="Delete this video and remove all generated files? This action cannot be undone."
				variant="destructive"
				confirmLabel="Delete video"
				pendingLabel="Deleting..."
				isPending={deleteMutation.isPending}
				onCancel={() => setIsDeleteConfirmOpen(false)}
				onConfirm={() => {
					deleteMutation.mutate();
				}}
			/>
		</main>
	);
}
