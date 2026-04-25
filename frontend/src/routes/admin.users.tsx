import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import {
	type AdminUser,
	requestAdminUsers,
	requestCreateUser,
	requestDeactivateUser,
	requestPermanentDeleteUser,
	requestResetUserPassword,
	requestUserDeleteReadiness,
} from "#/api/admin";
import { getApiErrorMessage } from "#/api/client";
import { requestAdminTokens, requestRevokeToken } from "#/api/tokens";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { formatDateTime } from "#/lib/format";

export const Route = createFileRoute("/admin/users")({
	component: AdminUsersPage,
});

type UserTab = "active" | "deactivated";

function AdminUsersPage() {
	const queryClient = useQueryClient();
	const [newUserId, setNewUserId] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [displayName, setDisplayName] = useState("");
	const [selectedTab, setSelectedTab] = useState<UserTab>("active");
	const [deleteDialogUser, setDeleteDialogUser] = useState<AdminUser | null>(
		null,
	);

	const isCreateUserDisabled = !newUserId.trim() || newPassword.length < 8;

	const usersQuery = useQuery({
		queryKey: ["admin", "users"],
		queryFn: requestAdminUsers,
	});

	const adminTokensQuery = useQuery({
		queryKey: ["admin", "api-tokens"],
		queryFn: requestAdminTokens,
	});

	const deleteReadinessQuery = useQuery({
		queryKey: ["admin", "users", "delete-readiness", deleteDialogUser?.id],
		enabled: Boolean(deleteDialogUser),
		retry: false,
		queryFn: () => {
			if (!deleteDialogUser) {
				throw new Error("Delete dialog user is not set.");
			}

			return requestUserDeleteReadiness(deleteDialogUser.id);
		},
	});

	const createUserMutation = useMutation({
		mutationFn: () =>
			requestCreateUser({
				id: newUserId.trim(),
				password: newPassword,
				displayName: displayName.trim(),
			}),
		onSuccess: async () => {
			setNewUserId("");
			setNewPassword("");
			setDisplayName("");
			await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});

	const resetPasswordMutation = useMutation({
		mutationFn: ({ userId, password }: { userId: string; password: string }) =>
			requestResetUserPassword(userId, password),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
		},
	});

	const deactivateUserMutation = useMutation({
		mutationFn: (userId: string) => requestDeactivateUser(userId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
			setSelectedTab("deactivated");
		},
	});

	const permanentDeleteMutation = useMutation({
		mutationFn: (userId: string) => requestPermanentDeleteUser(userId),
		onSuccess: async () => {
			setDeleteDialogUser(null);
			await queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
			await queryClient.invalidateQueries({
				queryKey: ["admin", "api-tokens"],
			});
		},
	});

	const revokeTokenMutation = useMutation({
		mutationFn: (tokenId: string) => requestRevokeToken(tokenId),
		onSuccess: async () => {
			await queryClient.invalidateQueries({
				queryKey: ["admin", "api-tokens"],
			});
		},
	});

	const tokenByUserId = new Map(
		(adminTokensQuery.data ?? []).map((token) => [token.userId, token]),
	);
	const users = usersQuery.data ?? [];
	const activeUsers = users.filter((user) => user.isActive);
	const deactivatedUsers = users.filter((user) => !user.isActive);
	const visibleUsers =
		selectedTab === "active" ? activeUsers : deactivatedUsers;

	const submitCreateUser = () => {
		if (isCreateUserDisabled || createUserMutation.isPending) {
			return;
		}

		createUserMutation.mutate();
	};

	const closeDeleteDialog = () => {
		permanentDeleteMutation.reset();
		setDeleteDialogUser(null);
	};

	const openDeleteDialog = (user: AdminUser) => {
		permanentDeleteMutation.reset();
		setDeleteDialogUser(user);
	};

	const deleteReadinessItems = deleteReadinessQuery.data
		? [
				{
					key: "isDeactivated",
					label: "User is already deactivated",
					satisfied: deleteReadinessQuery.data.checks.isDeactivated,
					detail: deleteReadinessQuery.data.checks.isDeactivated
						? "Ready"
						: "Deactivate this user first.",
				},
				{
					key: "ownedRepositoryCount",
					label: "Owned repositories",
					satisfied:
						deleteReadinessQuery.data.checks.ownedRepositoryCount === 0,
					detail:
						deleteReadinessQuery.data.checks.ownedRepositoryCount === 0
							? "None remaining"
							: `${deleteReadinessQuery.data.checks.ownedRepositoryCount} repository must be removed first.`,
				},
				{
					key: "repositoryMembershipCount",
					label: "Repository memberships",
					satisfied:
						deleteReadinessQuery.data.checks.repositoryMembershipCount === 0,
					detail:
						deleteReadinessQuery.data.checks.repositoryMembershipCount === 0
							? "None remaining"
							: `${deleteReadinessQuery.data.checks.repositoryMembershipCount} membership must be removed first.`,
				},
				{
					key: "recordingSessionCount",
					label: "Recording history references",
					satisfied:
						deleteReadinessQuery.data.checks.recordingSessionCount === 0,
					detail:
						deleteReadinessQuery.data.checks.recordingSessionCount === 0
							? "None remaining"
							: `${deleteReadinessQuery.data.checks.recordingSessionCount} recording reference blocks permanent deletion.`,
				},
			]
		: [];

	return (
		<>
			<main className="page-wrap px-4 py-8 sm:py-10">
				<header className="mb-6">
					<p className="island-kicker mb-2">Admin</p>
					<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
						Users
					</h1>
					<p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
						Create users, review active and deactivated accounts, and cleanly
						remove users that no longer have remaining references.
					</p>
				</header>

				<section className="island-shell rounded-2xl p-5 shadow-sm">
					<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
						Create user
					</h2>
					<form
						className="mt-4 grid gap-4 md:grid-cols-3"
						onSubmit={(event) => {
							event.preventDefault();
							submitCreateUser();
						}}
					>
						<div className="space-y-2">
							<Label htmlFor="new-user-id">User ID</Label>
							<Input
								id="new-user-id"
								value={newUserId}
								onChange={(event) => setNewUserId(event.target.value)}
								placeholder="alice"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="new-user-password">Password</Label>
							<Input
								id="new-user-password"
								type="password"
								value={newPassword}
								onChange={(event) => setNewPassword(event.target.value)}
								placeholder="At least 8 characters"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="new-user-display-name">Display name</Label>
							<Input
								id="new-user-display-name"
								value={displayName}
								onChange={(event) => setDisplayName(event.target.value)}
								placeholder="Optional"
							/>
						</div>

						<div className="md:col-span-3">
							<Button
								type="submit"
								disabled={createUserMutation.isPending || isCreateUserDisabled}
							>
								Create user
							</Button>
							{newPassword.length > 0 && newPassword.length < 8 ? (
								<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
									Password must be at least 8 characters.
								</p>
							) : null}
						</div>
					</form>

					{createUserMutation.isError ? (
						<p className="mt-4 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								createUserMutation.error,
								"Failed to create user.",
							)}
						</p>
					) : null}
				</section>

				<section className="mt-6">
					<div className="mb-4 flex flex-wrap gap-2">
						<Button
							type="button"
							variant={selectedTab === "active" ? "default" : "outline"}
							onClick={() => setSelectedTab("active")}
						>
							Active users ({activeUsers.length})
						</Button>
						<Button
							type="button"
							variant={selectedTab === "deactivated" ? "default" : "outline"}
							onClick={() => setSelectedTab("deactivated")}
						>
							Deactivated users ({deactivatedUsers.length})
						</Button>
					</div>

					<div className="space-y-4">
						{usersQuery.isPending || adminTokensQuery.isPending ? (
							<div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center text-[var(--sea-ink-soft)]">
								Loading users...
							</div>
						) : usersQuery.isError ? (
							<div className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
								{getApiErrorMessage(usersQuery.error, "Failed to load users.")}
							</div>
						) : visibleUsers.length === 0 ? (
							<div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center text-[var(--sea-ink-soft)]">
								{selectedTab === "active"
									? "No active users are available."
									: "No deactivated users are available."}
							</div>
						) : (
							visibleUsers.map((user) => {
								const token = tokenByUserId.get(user.id);

								return (
									<article
										key={user.id}
										className="island-shell rounded-2xl p-5 shadow-sm"
									>
										<div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
											<div>
												<div className="flex flex-wrap items-center gap-2">
													<h2 className="text-xl font-semibold text-[var(--sea-ink)]">
														{user.displayName || user.id}
													</h2>
													<span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
														{user.role}
													</span>
													<span
														className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
															user.isActive
																? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
																: "bg-slate-500/12 text-slate-700 dark:text-slate-300"
														}`}
													>
														{user.isActive ? "active" : "deactivated"}
													</span>
													<span
														className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
															token
																? "bg-amber-500/12 text-amber-700 dark:text-amber-300"
																: "bg-slate-500/12 text-slate-700 dark:text-slate-300"
														}`}
													>
														Python token: {token ? "issued" : "none"}
													</span>
												</div>
												<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
													{user.id}
												</p>
												<p className="mt-3 text-sm text-[var(--sea-ink-soft)]">
													Created {formatDateTime(user.createdAt)}
												</p>
												{token ? (
													<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
														Token{" "}
														<span className="font-semibold text-[var(--sea-ink)]">
															{token.name}
														</span>{" "}
														· Last used {formatDateTime(token.lastUsedAt)}
													</p>
												) : null}
											</div>

											<div className="flex flex-wrap gap-2">
												{token ? (
													<Button
														type="button"
														variant="outline"
														disabled={revokeTokenMutation.isPending}
														onClick={() => {
															if (
																!window.confirm(
																	`Revoke the Python token for ${user.id}?`,
																)
															) {
																return;
															}

															revokeTokenMutation.mutate(token.id);
														}}
													>
														Revoke token
													</Button>
												) : null}
												{user.isActive ? (
													<>
														<Button
															type="button"
															variant="outline"
															onClick={() => {
																const nextPassword = window.prompt(
																	`Enter a new password for ${user.id}`,
																);

																if (!nextPassword) {
																	return;
																}

																resetPasswordMutation.mutate({
																	userId: user.id,
																	password: nextPassword,
																});
															}}
															disabled={resetPasswordMutation.isPending}
														>
															Reset password
														</Button>
														<Button
															type="button"
															variant="destructive"
															disabled={
																deactivateUserMutation.isPending ||
																user.role === "admin"
															}
															onClick={() => {
																if (!window.confirm(`Deactivate ${user.id}?`)) {
																	return;
																}

																deactivateUserMutation.mutate(user.id);
															}}
														>
															Deactivate
														</Button>
													</>
												) : (
													<Button
														type="button"
														variant="destructive"
														disabled={
															permanentDeleteMutation.isPending ||
															user.role === "admin"
														}
														onClick={() => openDeleteDialog(user)}
													>
														Delete permanently
													</Button>
												)}
											</div>
										</div>
									</article>
								);
							})
						)}

						{adminTokensQuery.isError ? (
							<p className="text-sm text-red-700 dark:text-red-300">
								{getApiErrorMessage(
									adminTokensQuery.error,
									"Failed to load Python token status.",
								)}
							</p>
						) : null}

						{resetPasswordMutation.isError ? (
							<p className="text-sm text-red-700 dark:text-red-300">
								{getApiErrorMessage(
									resetPasswordMutation.error,
									"Failed to reset password.",
								)}
							</p>
						) : null}

						{deactivateUserMutation.isError ? (
							<p className="text-sm text-red-700 dark:text-red-300">
								{getApiErrorMessage(
									deactivateUserMutation.error,
									"Failed to deactivate user.",
								)}
							</p>
						) : null}

						{revokeTokenMutation.isError ? (
							<p className="text-sm text-red-700 dark:text-red-300">
								{getApiErrorMessage(
									revokeTokenMutation.error,
									"Failed to revoke token.",
								)}
							</p>
						) : null}
					</div>
				</section>
			</main>

			{deleteDialogUser ? (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
					<div className="w-full max-w-2xl rounded-2xl bg-background p-6 shadow-xl">
						<div className="flex items-start justify-between gap-4">
							<div>
								<p className="text-sm font-semibold uppercase tracking-[0.18em] text-[var(--sea-ink-soft)]">
									Permanent delete
								</p>
								<h2 className="mt-2 text-2xl font-semibold text-[var(--sea-ink)]">
									{deleteDialogUser.displayName || deleteDialogUser.id}
								</h2>
								<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
									Permanent deletion is only allowed after every remaining user
									reference is cleared. Recheck the blockers below after you
									finish the cleanup work.
								</p>
							</div>
							<Button type="button" variant="ghost" onClick={closeDeleteDialog}>
								Close
							</Button>
						</div>

						<div className="mt-5 rounded-2xl border border-amber-500/30 bg-amber-500/8 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
							Python tokens are removed automatically with the user row.
							Repository ownership, memberships, and recording history must be
							cleared before the final delete is allowed.
						</div>

						<div className="mt-5">
							{deleteReadinessQuery.isPending ? (
								<div className="rounded-2xl border border-dashed border-[var(--line)] px-4 py-8 text-sm text-[var(--sea-ink-soft)]">
									Checking deletion requirements...
								</div>
							) : deleteReadinessQuery.isError ? (
								<div className="rounded-2xl border border-red-500/25 bg-red-500/6 px-4 py-4 text-sm text-red-700 dark:text-red-300">
									{getApiErrorMessage(
										deleteReadinessQuery.error,
										"Failed to check permanent delete readiness.",
									)}
								</div>
							) : (
								<div className="space-y-3">
									{deleteReadinessItems.map((item) => (
										<div
											key={item.key}
											className="rounded-2xl border border-[var(--line)] px-4 py-4"
										>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<p className="font-medium text-[var(--sea-ink)]">
													{item.label}
												</p>
												<span
													className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
														item.satisfied
															? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
															: "bg-rose-500/12 text-rose-700 dark:text-rose-300"
													}`}
												>
													{item.satisfied ? "ready" : "blocked"}
												</span>
											</div>
											<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
												{item.detail}
											</p>
										</div>
									))}
								</div>
							)}
						</div>

						{permanentDeleteMutation.isError ? (
							<p className="mt-4 text-sm text-red-700 dark:text-red-300">
								{getApiErrorMessage(
									permanentDeleteMutation.error,
									"Failed to permanently delete user.",
								)}
							</p>
						) : null}

						<div className="mt-6 flex flex-wrap justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									void deleteReadinessQuery.refetch();
								}}
								disabled={
									deleteReadinessQuery.isPending ||
									permanentDeleteMutation.isPending
								}
							>
								Recheck requirements
							</Button>
							<Button
								type="button"
								variant="outline"
								onClick={closeDeleteDialog}
							>
								Cancel
							</Button>
							<Button
								type="button"
								variant="destructive"
								disabled={
									permanentDeleteMutation.isPending ||
									deleteReadinessQuery.isPending ||
									!deleteReadinessQuery.data?.canDelete
								}
								onClick={() => {
									if (!deleteDialogUser) {
										return;
									}

									permanentDeleteMutation.mutate(deleteDialogUser.id);
								}}
							>
								Delete
							</Button>
						</div>
					</div>
				</div>
			) : null}
		</>
	);
}
