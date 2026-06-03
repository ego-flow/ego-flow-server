import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { Activity, RadioTower, RefreshCcw, UploadCloud } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";

import { getApiErrorMessage, getBackendOrigin } from "#/api/client";
import {
	requestLiveStreamDetail,
	requestLiveStreamPlaybackTicket,
	requestLiveStreams,
} from "#/api/streams";
import { Button } from "#/components/ui/button";
import { UserRole } from "#/constants/auth/auth-constants";
import { useAuth } from "#/hooks/useAuth";

const HlsPlayer = lazy(() => import("#/components/HlsPlayer"));
const DIRECT_HLS_PORT = 8888;

export const Route = createFileRoute("/live")({
	component: LivePage,
});

const formatBytes = (value: number | null) => {
	if (value === null) {
		return "Unknown";
	}

	return new Intl.NumberFormat(undefined, {
		notation: value >= 1_000_000_000 ? "compact" : "standard",
		maximumFractionDigits: 1,
	}).format(value);
};

const buildDirectHlsUrl = (
	streamPath: string,
	playbackTicket: string,
	viewerUserId: string,
) => {
	const normalizedPath = streamPath.replace(/^\/+/, "");
	let host = "127.0.0.1";

	try {
		host = new URL(getBackendOrigin()).hostname || host;
	} catch {
		if (typeof window !== "undefined" && window.location.hostname) {
			host = window.location.hostname;
		}
	}

	const query = new URLSearchParams({
		ticket: playbackTicket,
		user_id: viewerUserId,
	});

	return `http://${host}:${DIRECT_HLS_PORT}/${normalizedPath}/index.m3u8?${query.toString()}`;
};

function LivePage() {
	const { isReady, isAuthenticated, session } = useAuth();
	const [selectedRecordingSessionId, setSelectedRecordingSessionId] = useState<
		string | null
	>(null);

	const streamsQuery = useQuery({
		queryKey: ["live-streams"],
		queryFn: requestLiveStreams,
		enabled: isReady && isAuthenticated,
		refetchInterval: 2000,
	});

	const streams = streamsQuery.data ?? [];
	const selectedStream =
		streams.find(
			(stream) => stream.recordingSessionId === selectedRecordingSessionId,
		) ?? null;

	const selectedStreamDetailQuery = useQuery({
		queryKey: ["live-streams", selectedRecordingSessionId],
		queryFn: () => {
			if (!selectedRecordingSessionId) {
				throw new Error("No stream selected.");
			}

			return requestLiveStreamDetail(selectedRecordingSessionId);
		},
		enabled: isReady && isAuthenticated && Boolean(selectedRecordingSessionId),
		refetchInterval: 2000,
		retry: false,
	});

	const selectedStreamDetail =
		selectedStreamDetailQuery.data?.recordingSessionId ===
		selectedStream?.recordingSessionId
			? selectedStreamDetailQuery.data
			: null;
	const selectedDeviceType =
		selectedStreamDetail?.deviceType ?? selectedStream?.deviceType ?? null;
	const selectedPlaybackReady = selectedStreamDetail?.playbackReady ?? false;
	const playbackTicketQuery = useQuery({
		queryKey: [
			"live-streams",
			selectedStream?.recordingSessionId,
			"playback-ticket",
		],
		queryFn: () => {
			if (!selectedStream) {
				throw new Error("No stream selected.");
			}

			return requestLiveStreamPlaybackTicket(selectedStream.recordingSessionId);
		},
		enabled:
			isReady &&
			isAuthenticated &&
			Boolean(
				selectedStream &&
					selectedStream.ingestType === "MEDIAMTX" &&
					selectedStream.playbackAvailable &&
					selectedPlaybackReady,
			),
		staleTime: 8 * 60 * 1000,
		retry: false,
	});
	const selectedPlaybackTicket = playbackTicketQuery.data?.playbackTicket ?? null;
	const viewerUserId = session?.user?.id ?? null;
	const selectedHlsUrl =
		selectedStream && selectedPlaybackTicket && viewerUserId
			? buildDirectHlsUrl(
					selectedStream.streamPath,
					selectedPlaybackTicket,
					viewerUserId,
				)
			: null;
	const canPlaySelectedStream = Boolean(
		selectedStream &&
			selectedStream.ingestType === "MEDIAMTX" &&
			selectedStream.playbackAvailable &&
			selectedPlaybackReady &&
			selectedPlaybackTicket &&
			selectedHlsUrl,
	);
	const isAdmin = session?.user?.role === UserRole.Admin;

	useEffect(() => {
		if (streams.length === 0) {
			setSelectedRecordingSessionId(null);
			return;
		}

		const selectedExists = streams.some(
			(stream) => stream.recordingSessionId === selectedRecordingSessionId,
		);
		if (!selectedExists) {
			setSelectedRecordingSessionId(streams[0].recordingSessionId);
		}
	}, [selectedRecordingSessionId, streams]);

	if (!isReady) {
		return null;
	}

	if (!isAuthenticated) {
		return <Navigate to="/login" />;
	}

	return (
		<main className="page-wrap px-4 py-8 sm:py-10">
			<header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<p className="island-kicker mb-2">Live</p>
					<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
						Stream Monitor
					</h1>
					<p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
						Watch active Redis-backed live sessions in real time.
					</p>
				</div>
				<div className="flex items-center gap-3">
					<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-2 text-sm text-[var(--sea-ink-soft)]">
						{streams.length} active stream{streams.length === 1 ? "" : "s"}
					</span>
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							void streamsQuery.refetch();
						}}
						disabled={streamsQuery.isFetching}
					>
						<RefreshCcw size={16} aria-hidden="true" />
						Refresh
					</Button>
				</div>
			</header>

			{streamsQuery.isError ? (
				<section className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
					{getApiErrorMessage(
						streamsQuery.error,
						"Failed to load active streams.",
					)}
				</section>
			) : null}

			<section className="grid gap-6 xl:grid-cols-[minmax(20rem,26rem)_minmax(0,1fr)]">
				<aside className="island-shell rounded-2xl p-4 shadow-sm">
					<div className="mb-4 flex items-center gap-2">
						<RadioTower
							size={18}
							aria-hidden="true"
							className="text-[var(--lagoon-deep)]"
						/>
						<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
							Active Sessions
						</h2>
					</div>

					{streamsQuery.isPending ? (
						<div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-10 text-center text-sm text-[var(--sea-ink-soft)]">
							Loading streams...
						</div>
					) : streams.length > 0 ? (
						<div className="space-y-3">
							{streams.map((stream) => (
								<button
									key={stream.recordingSessionId}
									type="button"
									onClick={() =>
										setSelectedRecordingSessionId(stream.recordingSessionId)
									}
									className={`w-full rounded-2xl border p-4 text-left transition-colors ${
										selectedRecordingSessionId === stream.recordingSessionId
											? "border-[color-mix(in_oklab,var(--lagoon-deep)_55%,var(--line))] bg-[var(--link-bg-hover)]"
											: "border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_86%,transparent)] hover:bg-[var(--link-bg-hover)]"
									}`}
								>
									<div className="flex items-center justify-between gap-3">
										<h3 className="truncate text-base font-semibold text-[var(--sea-ink)]">
											{stream.repositoryName}
										</h3>
										<span className="rounded-full bg-emerald-500/12 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
											{stream.ingestType === "HTTP" ? "HTTP" : "LIVE"}
										</span>
									</div>
									<dl className="mt-3 grid gap-2 text-sm text-[var(--sea-ink-soft)]">
										<div>
											<dt className="font-semibold text-[var(--sea-ink)]">
												Publisher
											</dt>
											<dd>{stream.userId}</dd>
										</div>
										{isAdmin ? (
											<div>
												<dt className="font-semibold text-[var(--sea-ink)]">
													Device
												</dt>
												<dd>{stream.deviceType || "Unknown"}</dd>
											</div>
										) : null}
										<div>
											<dt className="font-semibold text-[var(--sea-ink)]">
												Ingest
											</dt>
											<dd>
												{stream.ingestType === "HTTP"
													? `HTTP upload · ${formatBytes(stream.bytesReceived)} bytes`
													: "MediaMTX"}
											</dd>
										</div>
										<div>
											<dt className="font-semibold text-[var(--sea-ink)]">
												Session
											</dt>
											<dd className="truncate">
												{stream.recordingSessionId}
											</dd>
										</div>
									</dl>
								</button>
							))}
						</div>
					) : (
						<div className="rounded-xl border border-dashed border-[var(--line)] px-4 py-10 text-center">
							<Activity
								size={24}
								aria-hidden="true"
								className="mx-auto text-[var(--sea-ink-soft)]"
							/>
							<h3 className="mt-3 text-base font-semibold text-[var(--sea-ink)]">
								No active streams
							</h3>
							<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
								New publishing sessions will appear here automatically.
							</p>
						</div>
					)}
				</aside>

				<section className="island-shell rounded-2xl p-5 shadow-sm">
					<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
						<div>
							<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
								Live Playback
							</h2>
							<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
								{selectedStream
									? selectedStream.repositoryName
									: "Select an active stream to begin playback."}
							</p>
						</div>
						{selectedStream ? (
							<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-1 text-xs text-[var(--sea-ink-soft)]">
								{selectedDeviceType || "Unknown device"}
							</span>
						) : null}
					</div>

					{selectedStream ? (
						canPlaySelectedStream && selectedHlsUrl && selectedPlaybackTicket ? (
							<>
								<Suspense
									fallback={
										<div className="grid aspect-video place-items-center rounded-2xl border border-[var(--line)] bg-black text-sm text-white/70">
											Loading live player...
										</div>
									}
								>
									<HlsPlayer
										src={selectedHlsUrl}
										playbackTicket={selectedPlaybackTicket}
									/>
								</Suspense>
								<dl className="mt-5 grid gap-3 text-sm text-[var(--sea-ink-soft)]">
									<div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3">
										<dt className="font-semibold text-[var(--sea-ink)]">
											HLS URL
										</dt>
										<dd className="mt-1 break-all">{selectedHlsUrl}</dd>
									</div>
								</dl>
							</>
						) : selectedStream.ingestType === "MEDIAMTX" ? (
							<div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-[var(--line)] px-6 text-center">
								<div>
									<RadioTower
										size={28}
										aria-hidden="true"
										className="mx-auto text-[var(--lagoon-deep)]"
									/>
									<h3 className="mt-3 text-base font-semibold text-[var(--sea-ink)]">
										Playback is not ready
									</h3>
									<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
										{selectedStreamDetailQuery.isError
											? getApiErrorMessage(
													selectedStreamDetailQuery.error,
													"Failed to load stream playback status.",
												)
											: playbackTicketQuery.isError
												? getApiErrorMessage(
														playbackTicketQuery.error,
														"Failed to issue playback ticket.",
													)
											: "The stream is active, but MediaMTX has not reported a playable HLS path yet."}
									</p>
								</div>
							</div>
						) : (
							<div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-[var(--line)] px-6 text-center">
								<div>
									<UploadCloud
										size={28}
										aria-hidden="true"
										className="mx-auto text-[var(--lagoon-deep)]"
									/>
									<h3 className="mt-3 text-base font-semibold text-[var(--sea-ink)]">
										HTTP upload in progress
									</h3>
									<dl className="mt-4 grid gap-2 text-sm text-[var(--sea-ink-soft)]">
										<div>
											<dt className="font-semibold text-[var(--sea-ink)]">
												Received
											</dt>
											<dd>{formatBytes(selectedStream.bytesReceived)} bytes</dd>
										</div>
										<div>
											<dt className="font-semibold text-[var(--sea-ink)]">
												Last sequence
											</dt>
											<dd>
												{selectedStream.lastSequence === null
													? "None"
													: selectedStream.lastSequence}
											</dd>
										</div>
										<div>
											<dt className="font-semibold text-[var(--sea-ink)]">
												Last chunk
											</dt>
											<dd>
												{selectedStream.lastChunkAt
													? new Date(
															selectedStream.lastChunkAt,
														).toLocaleTimeString()
													: "None"}
											</dd>
										</div>
									</dl>
								</div>
							</div>
						)
					) : (
						<div className="grid min-h-80 place-items-center rounded-2xl border border-dashed border-[var(--line)] px-6 text-center">
							<div>
								<h3 className="text-base font-semibold text-[var(--sea-ink)]">
									Waiting for stream selection
								</h3>
								<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
									Start a publishing session from the app, then pick it from the
									list.
								</p>
							</div>
						</div>
					)}
				</section>
			</section>
		</main>
	);
}
