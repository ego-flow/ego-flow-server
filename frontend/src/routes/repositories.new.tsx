import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useState } from "react";

import { getApiErrorMessage } from "#/api/client";
import {
	RepositoryVisibility,
	requestCreateRepository,
} from "#/api/repositories";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
	defaultRepositoriesSearch,
	defaultRepositoryVideosSearch,
} from "#/lib/route-search";
import { parseRepositoryTags } from "#/utils/repository-tags";

export const Route = createFileRoute("/repositories/new")({
	component: NewRepositoryPage,
});

function NewRepositoryPage() {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [name, setName] = useState("");
	const [visibility, setVisibility] = useState<RepositoryVisibility>(
		RepositoryVisibility.Private,
	);
	const [description, setDescription] = useState("");
	const [tagsInput, setTagsInput] = useState("");
	const tags = parseRepositoryTags(tagsInput);

	const createMutation = useMutation({
		mutationFn: () =>
			requestCreateRepository({
				name,
				visibility,
				description,
				tags,
			}),
		onSuccess: async (repository) => {
			await queryClient.invalidateQueries({ queryKey: ["repositories"] });
			await navigate({
				to: "/repositories/$repoId",
				params: { repoId: repository.id },
				search: defaultRepositoryVideosSearch,
			});
		},
	});

	return (
		<main className="page-wrap px-4 py-8 sm:py-10">
			<section className="island-shell mb-6 rounded-2xl p-3 shadow-sm">
				<Link
					to="/repositories"
					search={defaultRepositoriesSearch}
					className="inline-flex w-fit items-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-2 text-sm font-semibold text-[var(--lagoon-deep)] no-underline transition-colors hover:bg-[var(--card)]"
				>
					<ArrowLeft size={16} aria-hidden="true" />
					Back to repositories
				</Link>
			</section>

			<section className="island-shell mx-auto max-w-3xl rounded-2xl p-6 shadow-sm">
				<p className="island-kicker mb-2">Repositories</p>
				<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
					Create repository
				</h1>
				<p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
					Streams, recordings, and permissions are now organized per repository.
				</p>

				<form
					className="mt-6 space-y-4"
					onSubmit={(event) => {
						event.preventDefault();
						createMutation.mutate();
					}}
				>
					<div className="space-y-2">
						<Label htmlFor="repository-name">Repository name</Label>
						<Input
							id="repository-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="daily_kitchen"
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="repository-visibility">Visibility</Label>
						<select
							id="repository-visibility"
							value={visibility}
							onChange={(event) =>
								setVisibility(event.target.value as RepositoryVisibility)
							}
							className="theme-select h-9 w-full rounded-md border border-input px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
						>
							<option value={RepositoryVisibility.Private}>private</option>
							<option value={RepositoryVisibility.Public}>public</option>
						</select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="repository-description">Description</Label>
						<textarea
							id="repository-description"
							value={description}
							onChange={(event) => setDescription(event.target.value)}
							rows={4}
							className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
							placeholder="Short description of what this repository is for."
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="repository-tags">Tags</Label>
						<Input
							id="repository-tags"
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

					{createMutation.isError ? (
						<p className="text-sm text-red-700 dark:text-red-300">
							{getApiErrorMessage(
								createMutation.error,
								"Failed to create repository.",
							)}
						</p>
					) : null}

					<Button
						type="submit"
						disabled={createMutation.isPending || !name.trim()}
					>
						Create repository
					</Button>
				</form>
			</section>
		</main>
	);
}
