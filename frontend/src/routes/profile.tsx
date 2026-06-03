import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useState } from "react";
import { getApiErrorMessage } from "#/api/client";
import {
	type RepositoryDeleteReadiness,
	requestDeactivatedRepositories,
	requestPermanentDeleteRepository,
	requestRepositoryDeleteReadiness,
} from "#/api/repositories";
import {
	requestCreateToken,
	requestCurrentToken,
	requestRevokeToken,
} from "#/api/tokens";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { UserRole } from "#/constants/auth/auth-constants";
import { useAuth } from "#/hooks/useAuth";
import { requestChangeMyPassword } from "#/lib/auth";
import { formatDateTime } from "#/lib/format";
import { userRoleClassName } from "#/utils/class-names";

export const Route = createFileRoute("/profile")({
	component: ProfilePage,
});

function ProfilePage() {
	const queryClient = useQueryClient();
	const { isReady, isAuthenticated, logout, session } = useAuth();
	const [currentPassword, setCurrentPassword] = useState("");
	const [newPassword, setNewPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [tokenName, setTokenName] = useState("python-package");
	const [issuedToken, setIssuedToken] = useState<{
		name: string;
		token: string;
		createdAt: string;
		rotatedPrevious: boolean;
	} | null>(null);
	const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
	const [successMessage, setSuccessMessage] = useState<string | null>(null);
	const [readinessByRepositoryId, setReadinessByRepositoryId] = useState<
		Record<string, RepositoryDeleteReadiness>
	>({});
	const [readinessRepositoryId, setReadinessRepositoryId] = useState<
		string | null
	>(null);
	const [deleteRepositoryId, setDeleteRepositoryId] = useState<string | null>(
		null,
	);

	const currentTokenQuery = useQuery({
		queryKey: ["auth", "token"],
		queryFn: requestCurrentToken,
	});

	const deactivatedRepositoriesQuery = useQuery({
		queryKey: ["repositories", "deactivated"],
		queryFn: requestDeactivatedRepositories,
		enabled: isReady && isAuthenticated,
	});

	const changePasswordMutation = useMutation({
		mutationFn: () =>
			requestChangeMyPassword({
				currentPassword,
				newPassword,
			}),
		onSuccess: (response) => {
			setCurrentPassword("");
			setNewPassword("");
			setConfirmPassword("");
			setSuccessMessage(response.message);
		},
		onError: () => {
			setSuccessMessage(null);
		},
	});

	const createTokenMutation = useMutation({
		mutationFn: () => requestCreateToken(tokenName.trim()),
		onSuccess: async (response) => {
			setIssuedToken({
				name: response.name,
				token: response.token,
				createdAt: response.createdAt,
				rotatedPrevious: response.rotatedPrevious,
			});
			setCopyFeedback(null);
			await queryClient.invalidateQueries({ queryKey: ["auth", "token"] });
		},
	});

	const revokeTokenMutation = useMutation({
		mutationFn: (tokenId: string) => requestRevokeToken(tokenId),
		onSuccess: async () => {
			setIssuedToken(null);
			setCopyFeedback(null);
			await queryClient.invalidateQueries({ queryKey: ["auth", "token"] });
		},
	});

	const readinessMutation = useMutation({
		mutationFn: (repoId: string) => requestRepositoryDeleteReadiness(repoId),
		onMutate: (repoId) => {
			setReadinessRepositoryId(repoId);
		},
		onSuccess: (readiness) => {
			setReadinessByRepositoryId((previous) => ({
				...previous,
				[readiness.repositoryId]: readiness,
			}));
		},
		onSettled: () => {
			setReadinessRepositoryId(null);
		},
	});

	const permanentDeleteRepositoryMutation = useMutation({
		mutationFn: (repoId: string) => requestPermanentDeleteRepository(repoId),
		onMutate: (repoId) => {
			setDeleteRepositoryId(repoId);
		},
		onSuccess: async (_response, repoId) => {
			setReadinessByRepositoryId((previous) => {
				const next = { ...previous };
				delete next[repoId];
				return next;
			});
			await queryClient.invalidateQueries({
				queryKey: ["repositories", "deactivated"],
			});
			await queryClient.invalidateQueries({ queryKey: ["repositories"] });
		},
		onSettled: () => {
			setDeleteRepositoryId(null);
		},
	});

	if (!isReady) {
		return null;
	}

	if (!isAuthenticated) {
		return <Navigate to="/login" />;
	}

	const isPasswordMismatch = newPassword !== confirmPassword;
	const currentToken = currentTokenQuery.data?.token ?? null;
	const deactivatedRepositories = deactivatedRepositoriesQuery.data ?? [];

	return (
		<main className="page-wrap relative px-4 py-10">
			<section className="island-shell mx-auto max-w-4xl rounded-2xl p-6 shadow-xl sm:p-8">
				<p className="island-kicker mb-2">Profile</p>
				<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
					{session?.user.displayName}
				</h1>
				<div className="mt-6 grid gap-3 text-sm text-[var(--sea-ink-soft)] sm:text-base">
					<div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3">
						<span className="font-semibold text-[var(--sea-ink)]">
							User ID:
						</span>{" "}
						{session?.user.id}
					</div>
					<div className="flex items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3">
						<span className="font-semibold text-[var(--sea-ink)]">Role:</span>
						<span
							className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${userRoleClassName(session?.user?.role)}`}
						>
							{session?.user?.role === UserRole.Admin
								? "Administrator"
								: "User"}
						</span>
					</div>
				</div>

				<section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--chip-bg)] p-5">
					<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
						Change password
					</h2>
					<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
						Enter your current password and set a new password.
					</p>

					<form
						className="mt-5 space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							setSuccessMessage(null);
							changePasswordMutation.mutate();
						}}
					>
						<div className="space-y-2">
							<Label htmlFor="current-password">Current password</Label>
							<Input
								id="current-password"
								type="password"
								autoComplete="current-password"
								value={currentPassword}
								onChange={(event) => setCurrentPassword(event.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="new-password">New password</Label>
							<Input
								id="new-password"
								type="password"
								autoComplete="new-password"
								value={newPassword}
								onChange={(event) => setNewPassword(event.target.value)}
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="confirm-password">Confirm new password</Label>
							<Input
								id="confirm-password"
								type="password"
								autoComplete="new-password"
								value={confirmPassword}
								onChange={(event) => setConfirmPassword(event.target.value)}
							/>
						</div>

						{isPasswordMismatch ? (
							<p className="text-sm text-red-700 dark:text-red-300">
								New password confirmation does not match.
							</p>
						) : null}

						{changePasswordMutation.isError ? (
							<p className="text-sm text-red-700 dark:text-red-300">
								{getApiErrorMessage(
									changePasswordMutation.error,
									"Failed to change password.",
								)}
							</p>
						) : null}

						{successMessage ? (
							<p className="text-sm text-emerald-700 dark:text-emerald-300">
								{successMessage}
							</p>
						) : null}

						<Button
							type="submit"
							disabled={changePasswordMutation.isPending || isPasswordMismatch}
						>
							Change password
						</Button>
					</form>
				</section>

				<section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--chip-bg)] p-5">
					<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
						Python token
					</h2>
					<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
						Use this token with the EgoFlow Python package via the
						<code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 text-xs">
							EGOFLOW_TOKEN
						</code>
						environment variable.
					</p>

					<form
						className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
						onSubmit={(event) => {
							event.preventDefault();
							setCopyFeedback(null);
							setIssuedToken(null);
							createTokenMutation.mutate();
						}}
					>
						<div className="flex-1 space-y-2">
							<Label htmlFor="token-name">Token name</Label>
							<Input
								id="token-name"
								value={tokenName}
								maxLength={100}
								onChange={(event) => setTokenName(event.target.value)}
								placeholder="python-package"
							/>
						</div>

						<Button
							type="submit"
							disabled={createTokenMutation.isPending || !tokenName.trim()}
						>
							{currentToken ? "Rotate token" : "Issue token"}
						</Button>
					</form>

					{createTokenMutation.isError ? (
						<p className="mt-4 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								createTokenMutation.error,
								"Failed to issue token.",
							)}
						</p>
					) : null}

					{currentTokenQuery.isPending ? (
						<div className="mt-5 rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-sm text-[var(--sea-ink-soft)]">
							Loading current token...
						</div>
					) : currentTokenQuery.isError ? (
						<div className="mt-5 rounded-xl border border-red-500/25 bg-red-500/6 px-4 py-4 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								currentTokenQuery.error,
								"Failed to load token status.",
							)}
						</div>
					) : currentToken ? (
						<div className="mt-5 rounded-xl border border-[var(--line)] bg-white/60 px-4 py-4">
							<div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
								<div className="space-y-2 text-sm text-[var(--sea-ink-soft)]">
									<p className="font-semibold text-[var(--sea-ink)]">
										Current token: issued
									</p>
									<p>
										<span className="font-semibold text-[var(--sea-ink)]">
											Name:
										</span>{" "}
										{currentToken.name}
									</p>
									<p>
										<span className="font-semibold text-[var(--sea-ink)]">
											Created:
										</span>{" "}
										{formatDateTime(currentToken.createdAt)}
									</p>
									<p>
										<span className="font-semibold text-[var(--sea-ink)]">
											Last used:
										</span>{" "}
										{formatDateTime(currentToken.lastUsedAt)}
									</p>
								</div>

								<Button
									type="button"
									variant="destructive"
									disabled={revokeTokenMutation.isPending}
									onClick={() => {
										if (!window.confirm("Revoke the current Python token?")) {
											return;
										}

										revokeTokenMutation.mutate(currentToken.id);
									}}
								>
									Revoke
								</Button>
							</div>
						</div>
					) : (
						<div className="mt-5 rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-sm text-[var(--sea-ink-soft)]">
							No active Python token has been issued yet.
						</div>
					)}

					{revokeTokenMutation.isError ? (
						<p className="mt-4 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								revokeTokenMutation.error,
								"Failed to revoke token.",
							)}
						</p>
					) : null}

					<div className="mt-4 space-y-2 text-sm text-[var(--sea-ink-soft)]">
						<p>Token values are shown only once right after issuance.</p>
						<p>Issuing a new token immediately invalidates the previous one.</p>
					</div>
				</section>

				<section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--chip-bg)] p-5">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
								Manage Deactivated Repositories
							</h2>
							<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
								Only deactivated repositories where you have admin permission
								are listed here.
							</p>
						</div>
						<Button
							type="button"
							variant="outline"
							disabled={deactivatedRepositoriesQuery.isFetching}
							onClick={() => {
								void deactivatedRepositoriesQuery.refetch();
							}}
						>
							Refresh
						</Button>
					</div>

					{deactivatedRepositoriesQuery.isPending ? (
						<div className="mt-5 rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-sm text-[var(--sea-ink-soft)]">
							Loading deactivated repositories...
						</div>
					) : deactivatedRepositoriesQuery.isError ? (
						<div className="mt-5 rounded-xl border border-red-500/25 bg-red-500/6 px-4 py-4 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								deactivatedRepositoriesQuery.error,
								"Failed to load deactivated repositories.",
							)}
						</div>
					) : deactivatedRepositories.length === 0 ? (
						<div className="mt-5 rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-sm text-[var(--sea-ink-soft)]">
							No deactivated repositories are available for your account.
						</div>
					) : (
						<div className="mt-5 space-y-4">
							{deactivatedRepositories.map((repository) => {
								const readiness = readinessByRepositoryId[repository.id];
								const isCheckingReadiness =
									readinessRepositoryId === repository.id &&
									readinessMutation.isPending;
								const isDeletingRepository =
									deleteRepositoryId === repository.id &&
									permanentDeleteRepositoryMutation.isPending;
								const hasDeleteBlockers = readiness
									? readiness.checks.activeStreamingSessionCount > 0 ||
										readiness.checks.finalizingSegmentCount > 0
									: true;

								return (
									<article
										key={repository.id}
										className="rounded-xl border border-[var(--line)] bg-white/60 px-4 py-4 dark:bg-white/5"
									>
										<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
											<div className="min-w-0">
												<h3 className="truncate text-base font-semibold text-[var(--sea-ink)]">
													{repository.name}
												</h3>
												<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
													Owner: {repository.ownerId}
												</p>
												<div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--sea-ink-soft)]">
													<span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1">
														{repository.visibility}
													</span>
													<span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1">
														{repository.videoCount ?? 0} videos
													</span>
													<span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1">
														Updated {formatDateTime(repository.updatedAt)}
													</span>
												</div>
												{repository.description ? (
													<p className="mt-3 text-sm text-[var(--sea-ink-soft)]">
														{repository.description}
													</p>
												) : null}
											</div>

											<div className="flex flex-wrap gap-2">
												<Button
													type="button"
													variant="outline"
													disabled={isCheckingReadiness || isDeletingRepository}
													onClick={() => {
														readinessMutation.mutate(repository.id);
													}}
												>
													{readiness ? "Recheck readiness" : "Check readiness"}
												</Button>
												<Button
													type="button"
													variant="destructive"
													disabled={
														!readiness?.canDelete ||
														isCheckingReadiness ||
														isDeletingRepository
													}
													onClick={() => {
														if (
															!window.confirm(
																`Permanently delete ${repository.name}? This cannot be undone.`,
															)
														) {
															return;
														}

														permanentDeleteRepositoryMutation.mutate(
															repository.id,
														);
													}}
												>
													Delete permanently
												</Button>
											</div>
										</div>

										{readiness ? (
											<div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3">
												<dl className="grid gap-3 text-sm sm:grid-cols-3">
													<div>
														<dt className="font-semibold text-[var(--sea-ink)]">
															Deactivated
														</dt>
														<dd className="mt-1 text-[var(--sea-ink-soft)]">
															{readiness.checks.isDeactivated ? "Yes" : "No"}
														</dd>
													</div>
													<div>
														<dt className="font-semibold text-[var(--sea-ink)]">
															Active streams
														</dt>
														<dd className="mt-1 text-[var(--sea-ink-soft)]">
															{readiness.checks.activeStreamingSessionCount}
														</dd>
													</div>
													<div>
														<dt className="font-semibold text-[var(--sea-ink)]">
															Finalizing segments
														</dt>
														<dd className="mt-1 text-[var(--sea-ink-soft)]">
															{readiness.checks.finalizingSegmentCount}
														</dd>
													</div>
												</dl>
												{readiness.canDelete ? (
													<p className="mt-3 text-sm text-emerald-700 dark:text-emerald-300">
														All checks passed. Permanent deletion is available.
													</p>
												) : hasDeleteBlockers ? (
													<p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
														Wait for active streams and finalization to finish
														before permanent deletion.
													</p>
												) : (
													<p className="mt-3 text-sm text-amber-700 dark:text-amber-300">
														This repository must remain deactivated before
														permanent deletion.
													</p>
												)}
											</div>
										) : null}
									</article>
								);
							})}
						</div>
					)}

					{readinessMutation.isError ? (
						<p className="mt-4 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								readinessMutation.error,
								"Failed to check repository delete readiness.",
							)}
						</p>
					) : null}

					{permanentDeleteRepositoryMutation.isError ? (
						<p className="mt-4 text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								permanentDeleteRepositoryMutation.error,
								"Failed to permanently delete repository.",
							)}
						</p>
					) : null}
				</section>

				<div className="mt-6">
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							void logout();
						}}
					>
						Log out
					</Button>
				</div>
			</section>

			{issuedToken ? (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
					<section className="island-shell w-full max-w-xl rounded-2xl p-6 shadow-xl">
						<p className="island-kicker mb-2">API Token</p>
						<h2 className="text-2xl font-semibold text-[var(--sea-ink)]">
							Copy this token now
						</h2>
						<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
							This is the only time EgoFlow will show the raw token value.
						</p>

						<div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-4">
							<p className="text-sm text-[var(--sea-ink-soft)]">
								<span className="font-semibold text-[var(--sea-ink)]">
									Name:
								</span>{" "}
								{issuedToken.name}
							</p>
							<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
								<span className="font-semibold text-[var(--sea-ink)]">
									Created:
								</span>{" "}
								{formatDateTime(issuedToken.createdAt)}
							</p>
							<pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 px-4 py-3 text-sm text-slate-100">
								{issuedToken.token}
							</pre>
						</div>

						{issuedToken.rotatedPrevious ? (
							<p className="mt-4 text-sm text-amber-700 dark:text-amber-300">
								The previous token has already been invalidated.
							</p>
						) : null}

						{copyFeedback ? (
							<p className="mt-4 text-sm text-[var(--sea-ink-soft)]">
								{copyFeedback}
							</p>
						) : null}

						<div className="mt-6 flex flex-wrap justify-end gap-3">
							<Button
								type="button"
								variant="outline"
								onClick={async () => {
									try {
										await navigator.clipboard.writeText(issuedToken.token);
										setCopyFeedback("Token copied to clipboard.");
									} catch {
										setCopyFeedback(
											"Clipboard copy failed. Copy the token manually.",
										);
									}
								}}
							>
								Copy token
							</Button>
							<Button
								type="button"
								onClick={() => {
									setIssuedToken(null);
									setCopyFeedback(null);
								}}
							>
								Close
							</Button>
						</div>
					</section>
				</div>
			) : null}
		</main>
	);
}
