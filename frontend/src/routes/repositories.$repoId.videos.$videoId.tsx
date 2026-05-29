import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Download, Trash2 } from "lucide-react";
import { getApiErrorMessage } from "#/api/client";
import {
	requestDeleteVideo,
	requestVideoDetail,
	requestVideoDownload,
	requestVideoStatus,
} from "#/api/videos";
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
import { contributorDisplayName } from "#/utils/display";

export const Route = createFileRoute("/repositories/$repoId/videos/$videoId")({
	component: RepositoryVideoDetailPage,
});

function formatClipSegments(value: unknown) {
	if (!value) {
		return "None";
	}

	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "Unavailable";
	}
}

function RepositoryVideoDetailPage() {
	const { repoId, videoId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const repositorySearch = useSearch({ from: "/repositories/$repoId" });

	const detailQuery = useQuery({
		queryKey: ["video-detail", repoId, videoId],
		queryFn: () => requestVideoDetail(repoId, videoId),
	});

	const statusQuery = useQuery({
		queryKey: ["video-status", repoId, videoId],
		queryFn: () => requestVideoStatus(repoId, videoId),
		refetchInterval: (query) =>
			query.state.data?.status === VideoStatus.Processing ||
			query.state.data?.status === VideoStatus.Pending
				? 5000
				: false,
	});

	const deleteMutation = useMutation({
		mutationFn: () => requestDeleteVideo(repoId, videoId),
		onSuccess: async () => {
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
		statusQuery.data?.status ?? detailQuery.data?.status ?? VideoStatus.Pending;
	const playbackUrl = video?.dashboardVideoUrl ?? null;

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
								if (
									!window.confirm(
										"Delete this video and remove all generated files?",
									)
								) {
									return;
								}

								deleteMutation.mutate();
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
						<span
							className={`rounded-full px-2.5 py-1 text-xs font-semibold ${videoStatusClassName(currentStatus)}`}
						>
							{currentStatus}
						</span>
						{statusQuery.data ? (
							<span className="text-sm text-[var(--sea-ink-soft)]">
								Progress {statusQuery.data.progress}%
							</span>
						) : null}
					</div>

					<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)]">
						{video?.repositoryName || "Video detail"}
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

				<aside className="space-y-6">
					<section className="island-shell rounded-2xl p-5 shadow-sm">
						<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
							Metadata
						</h2>
						<dl className="mt-4 space-y-3 text-sm text-[var(--sea-ink-soft)]">
							<div>
								<dt className="font-semibold text-[var(--sea-ink)]">
									Repository
								</dt>
								<dd>
									{video
										? `${video.ownerId}/${video.repositoryName}`
										: "Unavailable"}
								</dd>
							</div>
							<div>
								<dt className="font-semibold text-[var(--sea-ink)]">
									Video ID
								</dt>
								<dd className="break-all">{video?.id ?? videoId}</dd>
							</div>
							<div>
								<dt className="font-semibold text-[var(--sea-ink)]">Status</dt>
								<dd>{currentStatus}</dd>
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
					</section>

					<section className="island-shell rounded-2xl p-5 shadow-sm">
						<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
							Analysis
						</h2>
						<div className="mt-4 space-y-4 text-sm text-[var(--sea-ink-soft)]">
							<div>
								<h3 className="font-semibold text-[var(--sea-ink)]">
									Scene summary
								</h3>
								<p className="mt-1 whitespace-pre-wrap">
									{video?.sceneSummary || "No summary generated yet."}
								</p>
							</div>
							<div>
								<h3 className="font-semibold text-[var(--sea-ink)]">
									Clip segments
								</h3>
								<pre className="mt-1 overflow-x-auto rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] p-3 text-xs">
									{formatClipSegments(video?.clipSegments)}
								</pre>
							</div>
							{statusQuery.data?.errorMessage ? (
								<div>
									<h3 className="font-semibold text-[var(--sea-ink)]">
										Processing error
									</h3>
									<p className="mt-1 text-red-700 dark:text-red-300">
										{statusQuery.data.errorMessage}
									</p>
								</div>
							) : null}
						</div>
					</section>
				</aside>
			</section>
		</main>
	);
}
