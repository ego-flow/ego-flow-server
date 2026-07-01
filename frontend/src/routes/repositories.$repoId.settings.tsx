import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	useNavigate,
	useSearch,
} from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";

import { getApiErrorMessage } from "#/api/client";
import {
	RepositoryRole,
	RepositoryVisibility,
	requestAddRepositoryMember,
	requestDeactivateRepository,
	requestDeleteRepositoryMember,
	requestRepositoryDetail,
	requestRepositoryMembers,
	requestUpdateRepository,
	requestUpdateRepositoryMember,
} from "#/api/repositories";
import { ConfirmDialog } from "#/components/ConfirmDialog";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { formatDateTime } from "#/lib/format";
import { defaultRepositoriesSearch } from "#/lib/route-search";
import { repositoryDisplayName } from "#/utils/display";
import {
	formatRepositoryTags,
	parseRepositoryTags,
} from "#/utils/repository-tags";

export const Route = createFileRoute("/repositories/$repoId/settings")({
	component: RepositorySettingsPage,
});

function RepositorySettingsPage() {
	const { repoId } = Route.useParams();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const repositorySearch = useSearch({ from: "/repositories/$repoId" });
	const [name, setName] = useState("");
	const [visibility, setVisibility] = useState<RepositoryVisibility>(
		RepositoryVisibility.Private,
	);
	const [description, setDescription] = useState("");
	const [tagsInput, setTagsInput] = useState("");
	const [memberUserId, setMemberUserId] = useState("");
	const [memberRole, setMemberRole] = useState<RepositoryRole>(
		RepositoryRole.Read,
	);
	const [isDeactivateDialogOpen, setIsDeactivateDialogOpen] = useState(false);
	const [removeMemberConfirm, setRemoveMemberConfirm] = useState<{
		userId: string;
		displayName: string;
	} | null>(null);

	const repositoryQuery = useQuery({
		queryKey: ["repository", repoId],
		queryFn: () => requestRepositoryDetail(repoId),
	});

	const repository = repositoryQuery.data;

	const membersQuery = useQuery({
		queryKey: ["repository-members", repoId],
		queryFn: () => requestRepositoryMembers(repoId),
		enabled: repository?.myRole === RepositoryRole.Admin,
	});

	useEffect(() => {
		if (!repositoryQuery.data) {
			return;
		}

		setName(repositoryQuery.data.name);
		setVisibility(repositoryQuery.data.visibility);
		setDescription(repositoryQuery.data.description ?? "");
		setTagsInput(formatRepositoryTags(repositoryQuery.data.tags));
	}, [repositoryQuery.data]);

	const tags = parseRepositoryTags(tagsInput);

	const updateMutation = useMutation({
		mutationFn: () =>
			requestUpdateRepository(repoId, {
				name,
				visibility,
				description,
				tags,
			}),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["repositories"] });
			await queryClient.invalidateQueries({ queryKey: ["repository", repoId] });
		},
	});

	const deactivateRepositoryMutation = useMutation({
		mutationFn: () => requestDeactivateRepository(repoId),
		onSuccess: async () => {
			setIsDeactivateDialogOpen(false);
			void queryClient.invalidateQueries({ queryKey: ["repositories"] });
			void queryClient.invalidateQueries({ queryKey: ["repository", repoId] });
			void queryClient.invalidateQueries({
				queryKey: ["repositories", "deactivated"],
			});
			await navigate({
				to: "/repositories",
				search: defaultRepositoriesSearch,
			});
		},
	});

	const addMemberMutation = useMutation({
		mutationFn: () =>
			requestAddRepositoryMember(repoId, {
				userId: memberUserId,
				role: memberRole,
			}),
		onSuccess: async () => {
			setMemberUserId("");
			setMemberRole(RepositoryRole.Read);
			await queryClient.invalidateQueries({
				queryKey: ["repository-members", repoId],
			});
		},
	});

	const removeMemberMutation = useMutation({
		mutationFn: (userId: string) =>
			requestDeleteRepositoryMember(repoId, userId),
		onSuccess: async () => {
			setRemoveMemberConfirm(null);
			await queryClient.invalidateQueries({
				queryKey: ["repository-members", repoId],
			});
		},
	});

	const openDeactivateDialog = () => {
		deactivateRepositoryMutation.reset();
		setIsDeactivateDialogOpen(true);
	};

	const closeDeactivateDialog = () => {
		deactivateRepositoryMutation.reset();
		setIsDeactivateDialogOpen(false);
	};

	useEffect(() => {
		if (!repository || repository.myRole === RepositoryRole.Admin) {
			return;
		}

		void navigate({
			to: "/repositories/$repoId",
			params: { repoId },
			search: repositorySearch,
			replace: true,
		});
	}, [navigate, repoId, repository, repositorySearch]);

	if (repository && repository.myRole !== RepositoryRole.Admin) {
		return <main className="page-wrap px-4 py-8 sm:py-10" />;
	}

	return (
		<>
			<main className="page-wrap px-4 py-8 sm:py-10">
				<section className="island-shell mb-6 rounded-2xl p-3 shadow-sm">
					<Link
						to="/repositories/$repoId"
						params={{ repoId }}
						search={repositorySearch}
						className="inline-flex w-fit items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition-colors hover:bg-[var(--card)]"
					>
						<ArrowLeft size={16} aria-hidden="true" />
						Back to repository
					</Link>
				</section>

				{repositoryQuery.isError ? (
					<section className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
						{getApiErrorMessage(
							repositoryQuery.error,
							"Failed to load repository settings.",
						)}
					</section>
				) : null}

				{repository ? (
					<>
						<section className="island-shell rounded-2xl p-6 shadow-sm">
							<p className="island-kicker mb-2">Repository</p>
							<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
								Settings
							</h1>
							<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
								Manage repository metadata, visibility, and access control.
							</p>

							{repository.myRole !== RepositoryRole.Admin ? (
								<div className="mt-6 rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center text-[var(--sea-ink-soft)]">
									You need repository admin permission to update these settings.
								</div>
							) : (
								<form
									className="mt-6 space-y-4"
									onSubmit={(event) => {
										event.preventDefault();
										updateMutation.mutate();
									}}
								>
									<div className="space-y-2">
										<Label htmlFor="repo-name">Repository name</Label>
										<Input
											id="repo-name"
											value={name}
											onChange={(event) => setName(event.target.value)}
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="repo-visibility">Visibility</Label>
										<select
											id="repo-visibility"
											value={visibility}
											onChange={(event) =>
												setVisibility(
													event.target.value as RepositoryVisibility,
												)
											}
											className="theme-select h-9 w-full rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
										>
											<option value={RepositoryVisibility.Private}>
												private
											</option>
											<option value={RepositoryVisibility.Public}>
												public
											</option>
										</select>
									</div>

									<div className="space-y-2">
										<Label htmlFor="repo-description">Description</Label>
										<textarea
											id="repo-description"
											value={description}
											onChange={(event) => setDescription(event.target.value)}
											rows={4}
											className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
										/>
									</div>

									<div className="space-y-2">
										<Label htmlFor="repo-tags">Tags</Label>
										<Input
											id="repo-tags"
											value={tagsInput}
											onChange={(event) => setTagsInput(event.target.value)}
											placeholder="#kitchen, egocentric, daily task"
										/>
										{tags.length > 0 ? (
											<div className="flex flex-wrap gap-2">
												{tags.map((tag) => (
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

									{updateMutation.isError ? (
										<p className="text-sm text-red-700 dark:text-red-300">
											{getApiErrorMessage(
												updateMutation.error,
												"Failed to update repository.",
											)}
										</p>
									) : null}

									<div className="flex flex-wrap gap-3">
										<Button
											type="submit"
											disabled={updateMutation.isPending || !name.trim()}
										>
											Save changes
										</Button>
										<Button
											type="button"
											variant="destructive"
											disabled={deactivateRepositoryMutation.isPending}
											onClick={openDeactivateDialog}
										>
											Deactivate repository
										</Button>
									</div>
								</form>
							)}
						</section>

						{repository.myRole === RepositoryRole.Admin ? (
							<section className="island-shell mt-6 rounded-2xl p-6 shadow-sm">
								<h2 className="text-xl font-semibold text-[var(--sea-ink)]">
									Members
								</h2>
								<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
									Repository access is controlled per member.
								</p>

								<form
									className="mt-6 grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto]"
									onSubmit={(event) => {
										event.preventDefault();
										addMemberMutation.mutate();
									}}
								>
									<div className="space-y-2">
										<Label htmlFor="member-user-id">User ID</Label>
										<Input
											id="member-user-id"
											value={memberUserId}
											onChange={(event) => setMemberUserId(event.target.value)}
											placeholder="alice"
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="member-role">Role</Label>
										<select
											id="member-role"
											value={memberRole}
											onChange={(event) =>
												setMemberRole(event.target.value as RepositoryRole)
											}
											className="theme-select h-9 w-full rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
										>
											<option value={RepositoryRole.Read}>read</option>
											<option value={RepositoryRole.Maintain}>maintain</option>
											<option value={RepositoryRole.Admin}>admin</option>
										</select>
									</div>
									<div className="flex items-end">
										<Button
											type="submit"
											disabled={
												addMemberMutation.isPending || !memberUserId.trim()
											}
										>
											Add member
										</Button>
									</div>
								</form>

								{addMemberMutation.isError ? (
									<p className="mt-4 text-sm text-red-700 dark:text-red-300">
										{getApiErrorMessage(
											addMemberMutation.error,
											"Failed to add repository member.",
										)}
									</p>
								) : null}

								<div className="mt-6 space-y-4">
									{membersQuery.isPending ? (
										<div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center text-[var(--sea-ink-soft)]">
											Loading members...
										</div>
									) : membersQuery.isError ? (
										<div className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
											{getApiErrorMessage(
												membersQuery.error,
												"Failed to load repository members.",
											)}
										</div>
									) : (
										(membersQuery.data ?? []).map((member) => (
											<article
												key={member.userId}
												className="rounded-2xl border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] p-4"
											>
												<div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
													<div>
														<div className="flex flex-wrap items-center gap-2">
															<h3 className="text-lg font-semibold text-[var(--sea-ink)]">
																{member.displayName}
															</h3>
															<span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-xs text-[var(--sea-ink-soft)]">
																{member.role}
															</span>
															{member.isOwner ? (
																<span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-xs text-[var(--sea-ink-soft)]">
																	owner
																</span>
															) : null}
														</div>
														<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
															{member.userId}
														</p>
														<p className="mt-1 text-xs text-[var(--sea-ink-soft)]">
															Added {formatDateTime(member.createdAt)}
														</p>
													</div>

													<div className="flex flex-wrap items-center gap-2">
														{!member.isOwner ? (
															<>
																<select
																	value={member.role}
																	onChange={(event) => {
																		void requestUpdateRepositoryMember(
																			repoId,
																			member.userId,
																			event.target.value as RepositoryRole,
																		).then(async () => {
																			await queryClient.invalidateQueries({
																				queryKey: [
																					"repository-members",
																					repoId,
																				],
																			});
																		});
																	}}
																	className="theme-select h-9 rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
																>
																	<option value={RepositoryRole.Read}>
																		read
																	</option>
																	<option value={RepositoryRole.Maintain}>
																		maintain
																	</option>
																	<option value={RepositoryRole.Admin}>
																		admin
																	</option>
																</select>
																<Button
																	type="button"
																	variant="outline"
																	disabled={removeMemberMutation.isPending}
																	onClick={() => {
																		setRemoveMemberConfirm({
																			userId: member.userId,
																			displayName: member.displayName,
																		});
																	}}
																>
																	Remove
																</Button>
															</>
														) : null}
													</div>
												</div>
											</article>
										))
									)}
								</div>

								{removeMemberMutation.isError ? (
									<p className="mt-4 text-sm text-red-700 dark:text-red-300">
										{getApiErrorMessage(
											removeMemberMutation.error,
											"Failed to remove repository member.",
										)}
									</p>
								) : null}
							</section>
						) : null}
					</>
				) : null}
			</main>
			<ConfirmDialog
				open={Boolean(removeMemberConfirm)}
				title="Remove repository member"
				description={
					<>
						Remove{" "}
						<span className="font-semibold text-[var(--sea-ink)]">
							{removeMemberConfirm?.displayName}
						</span>{" "}
						from this repository? Their repository access will be revoked.
					</>
				}
				variant="destructive"
				confirmLabel="Remove"
				pendingLabel="Removing..."
				isPending={removeMemberMutation.isPending}
				onCancel={() => setRemoveMemberConfirm(null)}
				onConfirm={() => {
					if (!removeMemberConfirm) {
						return;
					}

					removeMemberMutation.mutate(removeMemberConfirm.userId);
				}}
			/>
			{isDeactivateDialogOpen ? (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
					<section className="island-shell w-full max-w-2xl rounded-2xl p-6 shadow-xl">
						<p className="island-kicker mb-2">Repository Deactivation</p>
						<h2 className="text-2xl font-semibold text-[var(--sea-ink)]">
							Deactivate {repositoryDisplayName(repository)}
						</h2>
						<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
							Deactivation hides this repository from normal repository views
							and prevents new uploads or streams. Existing streams and
							finalizing segments can continue to finish in the background.
						</p>
						<p className="mt-3 text-sm text-[var(--sea-ink-soft)]">
							Permanent deletion is handled later from Profile under Manage
							Deactivated Repositories after readiness checks pass.
						</p>

						{deactivateRepositoryMutation.isError ? (
							<p className="mt-4 text-sm text-red-700 dark:text-red-300">
								{getApiErrorMessage(
									deactivateRepositoryMutation.error,
									"Failed to deactivate repository.",
								)}
							</p>
						) : null}

						<div className="mt-6 flex flex-wrap justify-end gap-3">
							<Button
								type="button"
								variant="outline"
								disabled={deactivateRepositoryMutation.isPending}
								onClick={closeDeactivateDialog}
							>
								Cancel
							</Button>
							<Button
								type="button"
								variant="destructive"
								disabled={deactivateRepositoryMutation.isPending}
								onClick={() => {
									deactivateRepositoryMutation.mutate();
								}}
							>
								Deactivate repository
							</Button>
						</div>
					</section>
				</div>
			) : null}
		</>
	);
}
