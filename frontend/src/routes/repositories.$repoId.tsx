import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useNavigate,
	useRouterState,
} from "@tanstack/react-router";
import {
	ArrowLeft,
	Eye,
	EyeOff,
	PlayCircle,
	Settings,
	ShieldCheck,
	UserRound,
	UsersRound,
} from "lucide-react";
import type { ReactNode } from "react";

import { getApiErrorMessage } from "#/api/client";
import { requestRepositoryDetail } from "#/api/repositories";
import { requestVideos, type VideoProcessingProgress } from "#/api/videos";
import ProtectedImage from "#/components/ProtectedImage";
import { Button } from "#/components/ui/button";
import {
	RepositoryRole,
	RepositoryVisibility,
} from "#/constants/repository/repository-constants";
import {
	DEFAULT_VIDEO_SORT_BY,
	DEFAULT_VIDEO_SORT_ORDER,
	MAX_VIDEO_LIMIT,
	SortOrder,
	VideoSortBy,
	VideoStatus,
	VideoStatusFilter,
} from "#/constants/video/video-constants";
import {
	formatBytes,
	formatDateTime,
	formatDuration,
	formatResolution,
} from "#/lib/format";
import {
	defaultRepositoriesSearch,
	defaultRepositoryVideosSearch,
} from "#/lib/route-search";
import { saveVideoSnapshot } from "#/lib/video-snapshots";
import {
	repositoryRoleClassName,
	videoStatusClassName,
} from "#/utils/class-names";
import { contributorDisplayName } from "#/utils/display";
import { parseEnumValue } from "#/utils/enum";
import {
	parsePositiveInteger,
	parseTrimmedString,
} from "#/utils/search-params";

function parseVideoStatus(value: unknown): VideoStatus | VideoStatusFilter {
	return value === VideoStatusFilter.All
		? VideoStatusFilter.All
		: parseEnumValue(VideoStatus, value, VideoStatusFilter.All);
}

function parseSortBy(value: unknown): VideoSortBy {
	return parseEnumValue(VideoSortBy, value, DEFAULT_VIDEO_SORT_BY);
}

function parseSortOrder(value: unknown): SortOrder {
	return parseEnumValue(SortOrder, value, DEFAULT_VIDEO_SORT_ORDER);
}

function getSortOptionValue(sortBy: VideoSortBy, sortOrder: SortOrder) {
	return `${sortBy}:${sortOrder}`;
}

const SORT_OPTION_MAP: Record<
	string,
	{ sortBy: VideoSortBy; sortOrder: SortOrder }
> = {
	[getSortOptionValue(VideoSortBy.RecordedAt, SortOrder.Desc)]: {
		sortBy: VideoSortBy.RecordedAt,
		sortOrder: SortOrder.Desc,
	},
	[getSortOptionValue(VideoSortBy.RecordedAt, SortOrder.Asc)]: {
		sortBy: VideoSortBy.RecordedAt,
		sortOrder: SortOrder.Asc,
	},
	[getSortOptionValue(VideoSortBy.DurationSec, SortOrder.Desc)]: {
		sortBy: VideoSortBy.DurationSec,
		sortOrder: SortOrder.Desc,
	},
	[getSortOptionValue(VideoSortBy.DurationSec, SortOrder.Asc)]: {
		sortBy: VideoSortBy.DurationSec,
		sortOrder: SortOrder.Asc,
	},
	[getSortOptionValue(VideoSortBy.SizeBytes, SortOrder.Desc)]: {
		sortBy: VideoSortBy.SizeBytes,
		sortOrder: SortOrder.Desc,
	},
	[getSortOptionValue(VideoSortBy.SizeBytes, SortOrder.Asc)]: {
		sortBy: VideoSortBy.SizeBytes,
		sortOrder: SortOrder.Asc,
	},
};

function parseSortOptionValue(value: string): {
	sortBy: VideoSortBy;
	sortOrder: SortOrder;
} {
	return (
		SORT_OPTION_MAP[value] ?? {
			sortBy: DEFAULT_VIDEO_SORT_BY,
			sortOrder: DEFAULT_VIDEO_SORT_ORDER,
		}
	);
}

export const Route = createFileRoute("/repositories/$repoId")({
	validateSearch: (search: Record<string, unknown>) => ({
		page: parsePositiveInteger(search.page, defaultRepositoryVideosSearch.page),
		limit: parsePositiveInteger(
			search.limit,
			defaultRepositoryVideosSearch.limit,
			MAX_VIDEO_LIMIT,
		),
		status: parseVideoStatus(search.status),
		sortBy: parseSortBy(search.sortBy),
		sortOrder: parseSortOrder(search.sortOrder),
		contributorUserId: parseTrimmedString(search.contributorUserId),
	}),
	component: RepositoryDetailPage,
});

function MetaCard({
	icon,
	label,
	value,
}: {
	icon: ReactNode;
	label: string;
	value: ReactNode;
}) {
	return (
		<div className="min-w-0 rounded-xl bg-[var(--chip-bg)] px-3 py-2.5">
			<div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sea-ink-soft)]">
				{icon}
				{label}
			</div>
			<div className="mt-1.5 truncate text-sm font-semibold text-[var(--sea-ink)]">
				{value}
			</div>
		</div>
	);
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
		<div className="mt-3 flex min-w-0 items-center gap-2 text-sm text-[var(--sea-ink-soft)]">
			<div
				className="grid size-10 shrink-0 place-items-center rounded-full"
				style={{
					background: `conic-gradient(var(--lagoon-deep) ${degrees}deg, var(--line) ${degrees}deg)`,
				}}
				aria-hidden="true"
			>
				<div className="grid size-7 place-items-center rounded-full bg-[var(--card)] text-[10px] font-semibold text-[var(--sea-ink)]">
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

function RepositoryDetailPage() {
	const { repoId } = Route.useParams();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	if (pathname !== `/repositories/${repoId}`) {
		return <Outlet />;
	}

	return <RepositoryOverview repoId={repoId} />;
}

function RepositoryOverview({ repoId }: { repoId: string }) {
	const navigate = useNavigate({ from: "/repositories/$repoId" });
	const search = Route.useSearch();

	const repositoryQuery = useQuery({
		queryKey: ["repository", repoId],
		queryFn: () => requestRepositoryDetail(repoId),
	});

	const videosQuery = useQuery({
		queryKey: ["videos", "repository", repoId, search],
		queryFn: () =>
			requestVideos(repoId, {
				page: search.page,
				limit: search.limit,
				status: search.status,
				sortBy: search.sortBy,
				sortOrder: search.sortOrder,
				contributorUserId: search.contributorUserId,
			}),
	});

	const repository = repositoryQuery.data;
	const contributors = videosQuery.data?.contributors ?? [];
	const visibleContributors = contributors.slice(0, 5);
	const hiddenContributorCount = Math.max(
		0,
		contributors.length - visibleContributors.length,
	);
	const totalPages = Math.max(
		1,
		Math.ceil((videosQuery.data?.total ?? 0) / search.limit),
	);

	const updateSearch = (nextSearch: Partial<typeof search>) =>
		navigate({
			to: "/repositories/$repoId",
			params: { repoId },
			search: {
				...search,
				...nextSearch,
			},
		});

	return (
		<main className="page-wide px-4 py-8 sm:py-10">
			<div className="mx-auto grid w-full max-w-[89.5rem] gap-6 xl:grid-cols-[minmax(0,72rem)_16rem] xl:items-start">
				<div className="min-w-0">
					{repositoryQuery.isError ? (
						<section className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								repositoryQuery.error,
								"Failed to load repository.",
							)}
						</section>
					) : null}

					{repository ? (
						<>
							<section className="island-shell rounded-2xl p-4 shadow-sm sm:p-5">
								<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
									<Link
										to="/repositories"
										search={defaultRepositoriesSearch}
										className="inline-flex w-fit items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition-colors hover:bg-[var(--card)]"
									>
										<ArrowLeft size={16} aria-hidden="true" />
										Back to repositories
									</Link>

									{repository.myRole === RepositoryRole.Admin ? (
										<Link
											to="/repositories/$repoId/settings"
											params={{ repoId: repository.id }}
											search={search}
											className="no-underline"
										>
											<Button type="button" variant="outline">
												<Settings size={16} aria-hidden="true" />
												Repository settings
											</Button>
										</Link>
									) : null}
								</div>

								<div className="rounded-2xl bg-[color-mix(in_oklab,var(--card)_70%,var(--chip-bg))] px-5 py-6 sm:px-6 sm:py-7">
									<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_14rem] lg:items-center">
										<div className="min-w-0">
											<p className="island-kicker mb-3">Repository</p>
											<h1 className="display-title break-words text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
												{repository.name}
											</h1>
											<p className="mt-4 max-w-3xl text-base leading-7 text-[var(--sea-ink-soft)]">
												{repository.description || "No description provided."}
											</p>
											{repository.tags.length > 0 ? (
												<div className="mt-4 flex flex-wrap gap-2">
													{repository.tags.map((tag) => (
														<span
															key={tag.toLowerCase()}
															className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--lagoon-deep)]"
														>
															#{tag}
														</span>
													))}
												</div>
											) : null}
										</div>

										<div className="grid max-w-md gap-2 sm:grid-cols-3 lg:max-w-none lg:grid-cols-1">
											<MetaCard
												icon={<UserRound size={14} aria-hidden="true" />}
												label="Owner"
												value={repository.ownerId}
											/>
											<MetaCard
												icon={
													repository.visibility ===
													RepositoryVisibility.Public ? (
														<Eye size={14} aria-hidden="true" />
													) : (
														<EyeOff size={14} aria-hidden="true" />
													)
												}
												label="Visibility"
												value={
													<span
														className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
															repository.visibility ===
															RepositoryVisibility.Public
																? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
																: "bg-slate-500/12 text-slate-700 dark:text-slate-300"
														}`}
													>
														{repository.visibility}
													</span>
												}
											/>
											<MetaCard
												icon={<ShieldCheck size={14} aria-hidden="true" />}
												label="My role"
												value={
													<span
														className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${repositoryRoleClassName(repository.myRole)}`}
													>
														{repository.myRole}
													</span>
												}
											/>
										</div>
									</div>
								</div>
							</section>

							<section className="island-shell mt-6 rounded-2xl p-5 shadow-sm">
								<div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
									<div>
										<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
											Videos
										</h2>
										<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
											Filter and sort recordings within this repository.
										</p>
									</div>

									<div className="grid gap-3 sm:grid-cols-3 xl:min-w-[40rem]">
										<label className="space-y-1 text-sm text-[var(--sea-ink-soft)]">
											<span>Status</span>
											<select
												value={search.status}
												onChange={(event) => {
													void updateSearch({
														status: parseVideoStatus(event.target.value),
														page: 1,
													});
												}}
												className="theme-select h-9 w-full rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
											>
												<option value={VideoStatusFilter.All}>All</option>
												<option value={VideoStatus.Processing}>
													Processing
												</option>
												<option value={VideoStatus.Completed}>Completed</option>
												<option value={VideoStatus.Failed}>Failed</option>
											</select>
										</label>

										<label className="space-y-1 text-sm text-[var(--sea-ink-soft)]">
											<span>Contributor</span>
											<select
												value={search.contributorUserId}
												onChange={(event) => {
													void updateSearch({
														contributorUserId: parseTrimmedString(
															event.target.value,
														),
														page: 1,
													});
												}}
												className="theme-select h-9 w-full rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
											>
												<option value="">All contributors</option>
												{search.contributorUserId &&
												!contributors.some(
													(contributor) =>
														contributor.userId === search.contributorUserId,
												) ? (
													<option value={search.contributorUserId}>
														Selected contributor
													</option>
												) : null}
												{contributors.map((contributor) => (
													<option
														key={contributor.userId}
														value={contributor.userId}
													>
														{contributor.displayName}
													</option>
												))}
											</select>
										</label>

										<label className="space-y-1 text-sm text-[var(--sea-ink-soft)]">
											<span>Sort By</span>
											<select
												value={getSortOptionValue(
													search.sortBy,
													search.sortOrder,
												)}
												onChange={(event) => {
													const sort = parseSortOptionValue(event.target.value);
													void updateSearch({
														...sort,
														page: 1,
													});
												}}
												className="theme-select h-9 w-full rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
											>
												<option
													value={getSortOptionValue(
														VideoSortBy.RecordedAt,
														SortOrder.Desc,
													)}
												>
													Newest first
												</option>
												<option
													value={getSortOptionValue(
														VideoSortBy.RecordedAt,
														SortOrder.Asc,
													)}
												>
													Oldest first
												</option>
												<option
													value={getSortOptionValue(
														VideoSortBy.DurationSec,
														SortOrder.Desc,
													)}
												>
													Duration: longest first
												</option>
												<option
													value={getSortOptionValue(
														VideoSortBy.DurationSec,
														SortOrder.Asc,
													)}
												>
													Duration: shortest first
												</option>
												<option
													value={getSortOptionValue(
														VideoSortBy.SizeBytes,
														SortOrder.Desc,
													)}
												>
													Size: largest first
												</option>
												<option
													value={getSortOptionValue(
														VideoSortBy.SizeBytes,
														SortOrder.Asc,
													)}
												>
													Size: smallest first
												</option>
											</select>
										</label>
									</div>
								</div>

								<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
									<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-1 text-xs text-[var(--sea-ink-soft)]">
										{videosQuery.data?.total ?? 0} total
									</span>
									<span className="text-sm text-[var(--sea-ink-soft)]">
										Page {search.page} of {totalPages}
									</span>
								</div>

								{videosQuery.isPending ? (
									<div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center text-[var(--sea-ink-soft)]">
										Loading videos...
									</div>
								) : videosQuery.isError ? (
									<div className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
										{getApiErrorMessage(
											videosQuery.error,
											"Failed to load repository videos.",
										)}
									</div>
								) : videosQuery.data && videosQuery.data.data.length > 0 ? (
									<>
										<div className="grid gap-4">
											{videosQuery.data.data.map((video) => (
												<Link
													key={video.id}
													to="/repositories/$repoId/videos/$videoId"
													params={{ repoId: repository.id, videoId: video.id }}
													search={search}
													onClick={() => {
														saveVideoSnapshot(video);
													}}
													className="group rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] p-4 no-underline shadow-sm transition-transform hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--lagoon-deep)_38%,var(--line))]"
												>
													<div className="flex flex-col gap-4 sm:flex-row">
														<div className="flex h-36 w-full shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_72%,var(--background))] sm:w-56">
															{video.thumbnailUrl ? (
																<ProtectedImage
																	src={video.thumbnailUrl}
																	alt={video.id}
																	className="h-full w-full object-cover"
																	fallback={
																		<PlayCircle
																			size={36}
																			aria-hidden="true"
																			className="text-[var(--sea-ink-soft)]"
																		/>
																	}
																/>
															) : (
																<PlayCircle
																	size={36}
																	aria-hidden="true"
																	className="text-[var(--sea-ink-soft)]"
																/>
															)}
														</div>

														<div className="min-w-0 flex-1">
															<div className="flex flex-wrap items-center gap-2">
																<span
																	className={`rounded-full px-2.5 py-1 text-xs font-semibold ${videoStatusClassName(video.status)}`}
																>
																	{video.status}
																</span>
															</div>
															{video.status === VideoStatus.Processing ? (
																<ProcessingProgressIndicator
																	progress={video.processingProgress}
																/>
															) : null}

															<h3 className="mt-3 truncate text-xl font-semibold text-[var(--sea-ink)] transition-colors group-hover:text-[var(--lagoon-deep)]">
																{video.id}
															</h3>

															<dl className="mt-4 grid gap-2 text-sm text-[var(--sea-ink-soft)] sm:grid-cols-2 lg:grid-cols-3">
																<div>
																	<dt className="font-semibold text-[var(--sea-ink)]">
																		Duration
																	</dt>
																	<dd>{formatDuration(video.durationSec)}</dd>
																</div>
																<div>
																	<dt className="font-semibold text-[var(--sea-ink)]">
																		Resolution
																	</dt>
																	<dd>{formatResolution(video)}</dd>
																</div>
																<div>
																	<dt className="font-semibold text-[var(--sea-ink)]">
																		Codec
																	</dt>
																	<dd>{video.codec || "Unavailable"}</dd>
																</div>
																<div>
																	<dt className="font-semibold text-[var(--sea-ink)]">
																		Recorded at
																	</dt>
																	<dd>{formatDateTime(video.recordedAt)}</dd>
																</div>
																<div>
																	<dt className="font-semibold text-[var(--sea-ink)]">
																		Size
																	</dt>
																	<dd>{formatBytes(video.sizeBytes)}</dd>
																</div>
																<div>
																	<dt className="font-semibold text-[var(--sea-ink)]">
																		Contributor
																	</dt>
																	<dd>{contributorDisplayName(video)}</dd>
																</div>
															</dl>
														</div>
													</div>
												</Link>
											))}
										</div>

										<div className="mt-5 flex flex-wrap items-center justify-between gap-3">
											<Button
												type="button"
												variant="outline"
												disabled={search.page <= 1}
												onClick={() => {
													void updateSearch({
														page: Math.max(1, search.page - 1),
													});
												}}
											>
												Previous page
											</Button>
											<span className="text-sm text-[var(--sea-ink-soft)]">
												Showing page {search.page} of {totalPages}
											</span>
											<Button
												type="button"
												variant="outline"
												disabled={search.page >= totalPages}
												onClick={() => {
													void updateSearch({
														page: Math.min(totalPages, search.page + 1),
													});
												}}
											>
												Next page
											</Button>
										</div>
									</>
								) : (
									<div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center">
										<h3 className="text-lg font-semibold text-[var(--sea-ink)]">
											No videos found
										</h3>
										<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
											Adjust the filters or start an RTMP publish session into
											this repository.
										</p>
									</div>
								)}
							</section>
						</>
					) : null}
				</div>

				{repository ? (
					<aside className="island-shell rounded-2xl p-4 shadow-sm xl:sticky xl:top-24">
						<div className="mb-4 flex items-center justify-between gap-3">
							<div className="flex items-center gap-2">
								<UsersRound
									size={18}
									aria-hidden="true"
									className="text-[var(--lagoon-deep)]"
								/>
								<h2 className="text-base font-semibold text-[var(--sea-ink)]">
									Contributors
								</h2>
							</div>
							<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2.5 py-1 text-xs text-[var(--sea-ink-soft)]">
								{contributors.length}
							</span>
						</div>

						{contributors.length > 0 ? (
							<div className="space-y-2">
								{visibleContributors.map((contributor) => {
									const isSelected =
										search.contributorUserId === contributor.userId;

									return (
										<button
											key={contributor.userId}
											type="button"
											onClick={() => {
												void updateSearch({
													contributorUserId: isSelected
														? ""
														: contributor.userId,
													page: 1,
												});
											}}
											className={`w-full rounded-xl border px-3 py-2.5 text-left transition-colors ${
												isSelected
													? "border-[color-mix(in_oklab,var(--lagoon-deep)_55%,var(--line))] bg-[color-mix(in_oklab,var(--lagoon-deep)_10%,var(--card))]"
													: "border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] hover:bg-[var(--chip-bg)]"
											}`}
										>
											<div className="truncate text-sm font-semibold text-[var(--sea-ink)]">
												{contributor.displayName}
											</div>
										</button>
									);
								})}
								{hiddenContributorCount > 0 ? (
									<Link
										to="/repositories/$repoId/contributors"
										params={{ repoId: repository.id }}
										search={search}
										className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition-colors hover:bg-[var(--card)]"
									>
										View all contributors
									</Link>
								) : null}
							</div>
						) : (
							<div className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--sea-ink-soft)]">
								No contributors yet.
							</div>
						)}
					</aside>
				) : null}
			</div>
		</main>
	);
}
