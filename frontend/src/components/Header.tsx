import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import {
	Database,
	LogOut,
	RadioTower,
	Settings,
	Shield,
	UserRound,
} from "lucide-react";
import { requestRepositoryDetail } from "#/api/repositories";
import egoFlowIcon from "#/assets/EgoFlowIcon.png";
import ThemeToggle from "#/components/ThemeToggle";
import { Button } from "#/components/ui/button";
import { UserRole } from "#/constants/auth/auth-constants";
import { useAuth } from "#/hooks/useAuth";
import { defaultRepositoriesSearch } from "#/lib/route-search";

function getRepositoryIdFromPath(pathname: string) {
	const match = pathname.match(/^\/repositories\/([^/]+)(?:\/|$)/);
	const repoId = match?.[1];

	if (!repoId || repoId === "new") {
		return null;
	}

	try {
		return decodeURIComponent(repoId);
	} catch {
		return repoId;
	}
}

function isPathActive(pathname: string, path: string) {
	return pathname === path || pathname.startsWith(`${path}/`);
}

function navLinkClassName(isActive: boolean) {
	const base =
		"inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 no-underline transition-colors";

	return isActive
		? `${base} border-[color-mix(in_oklab,var(--lagoon-deep)_42%,var(--line))] bg-[color-mix(in_oklab,var(--lagoon-deep)_12%,var(--card))] text-[var(--lagoon-deep)] shadow-sm`
		: `${base} border-transparent text-[var(--sea-ink-soft)] hover:border-[var(--line)] hover:bg-[var(--chip-bg)] hover:text-[var(--sea-ink)]`;
}

export default function Header() {
	const { isReady, isAuthenticated, logout, session } = useAuth();
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	const currentRepositoryId = getRepositoryIdFromPath(pathname);
	const repositoryQuery = useQuery({
		queryKey: ["repository", currentRepositoryId],
		queryFn: () => requestRepositoryDetail(currentRepositoryId ?? ""),
		enabled: isReady && isAuthenticated && Boolean(currentRepositoryId),
	});

	if (!isReady) {
		return null;
	}

	const user = session?.user ?? null;
	const isAdmin = user?.role === UserRole.Admin;
	const identityLabel = user?.displayName;
	const repositoryTitle = currentRepositoryId
		? (repositoryQuery.data?.name ?? "Repository")
		: null;
	const repositoriesActive = isPathActive(pathname, "/repositories");
	const liveActive = isPathActive(pathname, "/live");
	const usersActive = isPathActive(pathname, "/admin/users");
	const settingsActive = isPathActive(pathname, "/admin/settings");
	const profileActive = isPathActive(pathname, "/profile");

	return (
		<header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] backdrop-blur-lg">
			<nav className="page-full flex flex-col gap-3 px-4 py-3 sm:px-6 xl:flex-row xl:items-center xl:justify-between xl:px-10 xl:py-4">
				<div className="flex min-w-0 items-center gap-3 xl:max-w-[38rem]">
					<Link
						to={isAuthenticated ? "/repositories" : "/login"}
						className="inline-flex min-w-0 items-center gap-2 text-lg font-bold text-[var(--sea-ink)] no-underline"
					>
						<img
							src={egoFlowIcon}
							alt="Ego Flow logo"
							className="h-6 w-6 object-contain"
						/>
						<span className="shrink-0">Ego Flow</span>
						{repositoryTitle ? (
							<>
								<span className="shrink-0 text-[var(--sea-ink-soft)]">/</span>
								<span className="min-w-0 max-w-[calc(100vw-9rem)] truncate text-lg font-bold text-[var(--sea-ink)] sm:max-w-[24rem] xl:max-w-[28rem]">
									{repositoryTitle}
								</span>
							</>
						) : null}
					</Link>
				</div>

				{isAuthenticated ? (
					<div className="-mx-1 flex min-w-0 items-center gap-2 overflow-x-auto px-1 pb-1 text-sm font-semibold sm:gap-3 xl:mx-0 xl:ml-auto xl:flex-wrap xl:justify-end xl:overflow-visible xl:px-0 xl:pb-0">
						<Link
							to="/repositories"
							search={defaultRepositoriesSearch}
							className={navLinkClassName(repositoriesActive)}
							aria-current={repositoriesActive ? "page" : undefined}
						>
							<Database size={15} aria-hidden="true" />
							Repositories
						</Link>
						<Link
							to="/live"
							className={navLinkClassName(liveActive)}
							aria-current={liveActive ? "page" : undefined}
						>
							<RadioTower size={15} aria-hidden="true" />
							Live
						</Link>
						{isAdmin ? (
							<>
								<Link
									to="/admin/users"
									className={navLinkClassName(usersActive)}
									aria-current={usersActive ? "page" : undefined}
								>
									<Shield size={15} aria-hidden="true" />
									Users
								</Link>
								<Link
									to="/admin/settings"
									className={navLinkClassName(settingsActive)}
									aria-current={settingsActive ? "page" : undefined}
								>
									<Settings size={15} aria-hidden="true" />
									Settings
								</Link>
							</>
						) : null}
						<Link
							to="/profile"
							className={navLinkClassName(profileActive)}
							aria-current={profileActive ? "page" : undefined}
						>
							<UserRound size={15} aria-hidden="true" />
							Profile
						</Link>
						<div className="flex shrink-0 items-center gap-2 sm:gap-3">
							<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-1 text-xs text-[var(--sea-ink-soft)] sm:text-sm">
								{identityLabel ?? "Signed in"}
							</span>
							<ThemeToggle />
							<Button
								type="button"
								variant="outline"
								size="icon"
								onClick={() => {
									void logout();
								}}
								aria-label="Logout"
								title="Logout"
							>
								<LogOut size={16} aria-hidden="true" />
							</Button>
						</div>
					</div>
				) : null}
			</nav>
		</header>
	);
}
