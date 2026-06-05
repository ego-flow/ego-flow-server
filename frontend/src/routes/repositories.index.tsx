import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	Database,
	Eye,
	EyeOff,
	FolderOpen,
	Plus,
	RefreshCcw,
	Search,
	ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { getApiErrorMessage } from "#/api/client";
import { type RepositoryRecord, requestRepositories } from "#/api/repositories";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	RepositoryRole,
	RepositoryVisibility,
} from "#/constants/repository/repository-constants";
import { formatDateTime } from "#/lib/format";
import { defaultRepositoryVideosSearch } from "#/lib/route-search";
import { repositoryRoleClassName } from "#/utils/class-names";
import { repositoryTagsMatchQuery } from "#/utils/repository-tags";

export const Route = createFileRoute("/repositories/")({
	validateSearch: (search: Record<string, unknown>) => ({
		repositoryId:
			typeof search.repositoryId === "string" ? search.repositoryId : "",
	}),
	component: RepositoriesPage,
});

type VisibilityFilter = "all" | RepositoryVisibility;
type RoleFilter = "all" | RepositoryRole;
type DescriptionFilter = "all" | "withDescription" | "withoutDescription";
type CreatedAtFilter = "all" | "last7" | "last30" | "last90" | "olderThan90";
type DatasetCountFilter =
	| "all"
	| "zero"
	| "oneToFifty"
	| "fiftyToOneHundred"
	| "oneHundredPlus";

const DAY_MS = 24 * 60 * 60 * 1000;

function RepositoriesPage() {
	const navigate = useNavigate({ from: "/repositories/" });
	const search = Route.useSearch();
	const [queryText, setQueryText] = useState(search.repositoryId);
	const [visibilityFilter, setVisibilityFilter] =
		useState<VisibilityFilter>("all");
	const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
	const [descriptionFilter, setDescriptionFilter] =
		useState<DescriptionFilter>("all");
	const [createdAtFilter, setCreatedAtFilter] =
		useState<CreatedAtFilter>("all");
	const [datasetCountFilter, setDatasetCountFilter] =
		useState<DatasetCountFilter>("all");
	const [tagQueryText, setTagQueryText] = useState("");

	useEffect(() => {
		setQueryText(search.repositoryId);
	}, [search.repositoryId]);

	const repositoriesQuery = useQuery({
		queryKey: ["repositories"],
		queryFn: requestRepositories,
	});

	const normalizedQuery = queryText.trim().toLowerCase();
	const normalizedTagQuery = tagQueryText.trim().replace(/^#+/, "").trim();
	const visibleRepositories = (repositoriesQuery.data ?? []).filter(
		(repository) => {
			if (normalizedQuery) {
				const searchableText = [
					repository.name,
					repository.ownerId,
					repository.description ?? "",
				]
					.join(" ")
					.toLowerCase();

				if (!searchableText.includes(normalizedQuery)) {
					return false;
				}
			}

			if (
				visibilityFilter !== "all" &&
				repository.visibility !== visibilityFilter
			) {
				return false;
			}

			if (roleFilter !== "all" && repository.myRole !== roleFilter) {
				return false;
			}

			if (!repositoryTagsMatchQuery(repository.tags, tagQueryText)) {
				return false;
			}

			const hasDescription = Boolean(repository.description?.trim());
			if (descriptionFilter === "withDescription" && !hasDescription) {
				return false;
			}
			if (descriptionFilter === "withoutDescription" && hasDescription) {
				return false;
			}

			if (createdAtFilter !== "all") {
				const createdAtMs = Date.parse(repository.createdAt);

				if (Number.isNaN(createdAtMs)) {
					return false;
				}

				const ageMs = Date.now() - createdAtMs;
				if (createdAtFilter === "last7" && ageMs > 7 * DAY_MS) {
					return false;
				}
				if (createdAtFilter === "last30" && ageMs > 30 * DAY_MS) {
					return false;
				}
				if (createdAtFilter === "last90" && ageMs > 90 * DAY_MS) {
					return false;
				}
				if (createdAtFilter === "olderThan90" && ageMs <= 90 * DAY_MS) {
					return false;
				}
			}

			const datasetCount = repository.videoCount ?? 0;
			if (datasetCountFilter === "zero") {
				return datasetCount === 0;
			}
			if (datasetCountFilter === "oneToFifty") {
				return datasetCount >= 1 && datasetCount <= 50;
			}
			if (datasetCountFilter === "fiftyToOneHundred") {
				return datasetCount > 50 && datasetCount <= 100;
			}
			if (datasetCountFilter === "oneHundredPlus") {
				return datasetCount > 100;
			}

			return true;
		},
	);
	const repositories = repositoriesQuery.data ?? [];
	const activeFilterCount = [
		normalizedQuery,
		visibilityFilter !== "all",
		roleFilter !== "all",
		normalizedTagQuery,
		descriptionFilter !== "all",
		createdAtFilter !== "all",
		datasetCountFilter !== "all",
	].filter(Boolean).length;

	const applyFilter = async (next: string) => {
		await navigate({
			to: "/repositories",
			search: {
				repositoryId: next,
			},
		});
	};

	const resetFilter = async () => {
		setQueryText("");
		setVisibilityFilter("all");
		setRoleFilter("all");
		setTagQueryText("");
		setDescriptionFilter("all");
		setCreatedAtFilter("all");
		setDatasetCountFilter("all");
		await applyFilter("");
	};

	return (
		<main className="page-full px-6 py-8 sm:py-10">
			<div className="grid gap-6 xl:grid-cols-[18rem_minmax(0,1fr)]">
				<aside className="hidden xl:block">
					<div className="island-shell sticky top-24 rounded-2xl p-5 shadow-sm">
						<div className="flex items-start justify-between gap-3">
							<div>
								<p className="island-kicker mb-2">Filters</p>
								<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
									Repositories
								</h2>
							</div>
							<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
								{visibleRepositories.length}/{repositories.length}
							</span>
						</div>

						<div className="mt-5 space-y-4">
							<FilterSelect
								id="repository-visibility-filter"
								label="Visibility"
								value={visibilityFilter}
								onChange={(value) =>
									setVisibilityFilter(value as VisibilityFilter)
								}
								options={[
									{ value: "all", label: "All visibility" },
									{ value: RepositoryVisibility.Public, label: "Public" },
									{ value: RepositoryVisibility.Private, label: "Private" },
								]}
							/>
							<FilterSelect
								id="repository-role-filter"
								label="My role"
								value={roleFilter}
								onChange={(value) => setRoleFilter(value as RoleFilter)}
								options={[
									{ value: "all", label: "All roles" },
									{ value: RepositoryRole.Admin, label: "Admin" },
									{ value: RepositoryRole.Maintain, label: "Maintain" },
									{ value: RepositoryRole.Read, label: "Read" },
								]}
							/>
							<div className="space-y-2">
								<label
									htmlFor="repository-tag-filter"
									className="text-sm font-semibold text-[var(--sea-ink)]"
								>
									Tag
								</label>
								<div className="relative">
									<Search
										size={16}
										aria-hidden="true"
										className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sea-ink-soft)]"
									/>
									<Input
										id="repository-tag-filter"
										value={tagQueryText}
										onChange={(event) => setTagQueryText(event.target.value)}
										placeholder="Search tags"
										className="h-9 pl-9"
									/>
								</div>
							</div>
							<FilterSelect
								id="repository-description-filter"
								label="Description"
								value={descriptionFilter}
								onChange={(value) =>
									setDescriptionFilter(value as DescriptionFilter)
								}
								options={[
									{ value: "all", label: "Any description" },
									{ value: "withDescription", label: "Has description" },
									{ value: "withoutDescription", label: "No description" },
								]}
							/>
							<FilterSelect
								id="repository-created-filter"
								label="Created"
								value={createdAtFilter}
								onChange={(value) =>
									setCreatedAtFilter(value as CreatedAtFilter)
								}
								options={[
									{ value: "all", label: "Any created date" },
									{ value: "last7", label: "Last 7 days" },
									{ value: "last30", label: "Last 30 days" },
									{ value: "last90", label: "Last 90 days" },
									{ value: "olderThan90", label: "Older than 90 days" },
								]}
							/>
							<FilterSelect
								id="repository-dataset-filter"
								label="Datasets"
								value={datasetCountFilter}
								onChange={(value) =>
									setDatasetCountFilter(value as DatasetCountFilter)
								}
								options={[
									{ value: "all", label: "Any dataset count" },
									{ value: "zero", label: "0 datasets" },
									{ value: "oneToFifty", label: "1-50 datasets" },
									{
										value: "fiftyToOneHundred",
										label: "50-100 datasets",
									},
									{ value: "oneHundredPlus", label: "100+ datasets" },
								]}
							/>
						</div>

						<div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-3 text-sm text-[var(--sea-ink-soft)]">
							<span className="font-semibold text-[var(--sea-ink)]">
								{activeFilterCount}
							</span>{" "}
							active filters
						</div>

						<Button
							type="button"
							variant="outline"
							className="mt-4 w-full"
							onClick={() => {
								void resetFilter();
							}}
						>
							<RefreshCcw size={16} aria-hidden="true" />
							Reset filters
						</Button>
					</div>
				</aside>

				<div className="min-w-0">
					<section className="island-shell mb-6 rounded-2xl p-4 shadow-sm">
						<form
							className="flex flex-col gap-3 sm:flex-row sm:items-center"
							onSubmit={(event) => {
								event.preventDefault();
								void applyFilter(queryText.trim());
							}}
						>
							<div className="relative flex-1">
								<Search
									size={16}
									aria-hidden="true"
									className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--sea-ink-soft)]"
								/>
								<Input
									id="repository-search"
									value={queryText}
									onChange={(event) => setQueryText(event.target.value)}
									placeholder="Search by name, owner, or description"
									className="h-10 pl-9"
								/>
							</div>
							<div className="flex gap-2">
								<Button type="submit">Search</Button>
								<Button
									type="button"
									variant="outline"
									onClick={() => {
										void resetFilter();
									}}
								>
									<RefreshCcw size={16} aria-hidden="true" />
									Reset
								</Button>
							</div>
						</form>
					</section>

					<header className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<p className="island-kicker mb-2">Dashboard</p>
							<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
								Repositories
							</h1>
							<p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
								Browse accessible repositories and inspect processed recordings
								by repository.
							</p>
						</div>
						<Link to="/repositories/new" className="no-underline">
							<Button type="button">
								<Plus size={16} aria-hidden="true" />
								New repository
							</Button>
						</Link>
					</header>

					<section className="flex flex-col gap-3">
						{repositoriesQuery.isPending ? (
							<div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-8 text-center text-[var(--sea-ink-soft)]">
								Loading repositories...
							</div>
						) : repositoriesQuery.isError ? (
							<div className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
								{getApiErrorMessage(
									repositoriesQuery.error,
									"Failed to load repositories.",
								)}
							</div>
						) : visibleRepositories.length > 0 ? (
							visibleRepositories.map((repository) => (
								<RepositoryRow key={repository.id} repository={repository} />
							))
						) : (
							<div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-10 text-center">
								<FolderOpen
									className="mx-auto text-[var(--sea-ink-soft)]"
									size={28}
									aria-hidden="true"
								/>
								<h2 className="mt-3 text-lg font-semibold text-[var(--sea-ink)]">
									{activeFilterCount > 0
										? "No matching repositories"
										: "No repositories yet"}
								</h2>
								<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
									{activeFilterCount > 0
										? "Try different filters or reset the repository filters."
										: "Create a repository before starting a new stream."}
								</p>
							</div>
						)}
					</section>
				</div>
			</div>
		</main>
	);
}

function FilterSelect({
	id,
	label,
	value,
	options,
	onChange,
}: {
	id: string;
	label: string;
	value: string;
	options: Array<{ value: string; label: string }>;
	onChange: (value: string) => void;
}) {
	return (
		<div className="space-y-2">
			<label
				htmlFor={id}
				className="text-sm font-semibold text-[var(--sea-ink)]"
			>
				{label}
			</label>
			<select
				id={id}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				className="theme-select h-9 w-full rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
			>
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
		</div>
	);
}

function RepositoryRow({ repository }: { repository: RepositoryRecord }) {
	const isPublic = repository.visibility === RepositoryVisibility.Public;
	const datasetCount = repository.videoCount ?? 0;

	return (
		<Link
			to="/repositories/$repoId"
			params={{ repoId: repository.id }}
			search={defaultRepositoryVideosSearch}
			className="island-shell block w-full rounded-2xl p-5 no-underline shadow-sm transition-transform hover:-translate-y-0.5"
		>
			<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
				<div className="min-w-0 flex-1">
					<h2 className="truncate text-xl font-bold text-[var(--sea-ink)]">
						{repository.name}
					</h2>
					<p className="mt-2 line-clamp-2 text-sm text-[var(--sea-ink-soft)]">
						{repository.description || "No description provided."}
					</p>
					{repository.tags.length > 0 ? (
						<div className="mt-3 flex flex-wrap gap-2">
							{repository.tags.slice(0, 5).map((tag) => (
								<span
									key={tag.toLowerCase()}
									className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--lagoon-deep)]"
								>
									#{tag}
								</span>
							))}
							{repository.tags.length > 5 ? (
								<span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
									+{repository.tags.length - 5}
								</span>
							) : null}
						</div>
					) : null}
				</div>

				<div className="flex w-full shrink-0 flex-wrap items-center gap-2 lg:w-auto lg:justify-end">
					<Chip
						icon={
							isPublic ? (
								<Eye size={12} aria-hidden="true" />
							) : (
								<EyeOff size={12} aria-hidden="true" />
							)
						}
						label="Visibility"
						value={repository.visibility}
						tone={isPublic ? "emerald" : "slate"}
					/>
					<Chip
						icon={<ShieldCheck size={12} aria-hidden="true" />}
						label="My role"
						value={repository.myRole}
						valueClassName={repositoryRoleClassName(repository.myRole)}
					/>
					<Chip
						icon={<Database size={12} aria-hidden="true" />}
						label="Datasets"
						value={datasetCount.toLocaleString()}
						tone="lagoon"
					/>
				</div>
			</div>

			<div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--line)] pt-3 text-xs text-[var(--sea-ink-soft)]">
				<span>
					Created{" "}
					<span className="text-[var(--sea-ink)]">
						{formatDateTime(repository.createdAt)}
					</span>
				</span>
				<span aria-hidden="true">·</span>
				<span>
					Updated{" "}
					<span className="text-[var(--sea-ink)]">
						{formatDateTime(repository.updatedAt)}
					</span>
				</span>
			</div>
		</Link>
	);
}

function Chip({
	icon,
	label,
	value,
	tone,
	valueClassName,
}: {
	icon: ReactNode;
	label: string;
	value: string;
	tone?: "emerald" | "slate" | "lagoon";
	valueClassName?: string;
}) {
	const defaultToneClass =
		tone === "emerald"
			? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
			: tone === "lagoon"
				? "bg-sky-500/14 text-sky-700 dark:text-sky-300"
				: tone === "slate"
					? "bg-slate-500/12 text-slate-700 dark:text-slate-300"
					: "bg-[var(--chip-bg)] text-[var(--sea-ink)]";

	return (
		<div className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--chip-bg)] py-1 pl-2 pr-2.5 text-xs">
			<span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--sea-ink-soft)]">
				{icon}
				{label}
			</span>
			<span
				className={`rounded-full px-2 py-0.5 text-xs font-semibold ${valueClassName ?? defaultToneClass}`}
			>
				{value}
			</span>
		</div>
	);
}
