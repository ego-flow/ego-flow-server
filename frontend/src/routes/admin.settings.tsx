import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Lock } from "lucide-react";

import {
	type AdminSettingEntry,
	type AdminSettingValue,
	requestAdminSettings,
} from "#/api/admin";
import { getApiErrorMessage } from "#/api/client";

export const Route = createFileRoute("/admin/settings")({
	component: AdminSettingsPage,
});

function formatValue(value: AdminSettingValue) {
	if (value === null) {
		return "(null)";
	}
	if (typeof value === "boolean") {
		return value ? "true" : "false";
	}
	return String(value);
}

function SettingEntryRow({
	entry,
	depth = 0,
}: {
	entry: AdminSettingEntry;
	depth?: number;
}) {
	return (
		<>
			<div
				className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-4 py-2.5 text-sm"
				style={{ paddingLeft: depth > 0 ? `${depth * 1.25}rem` : undefined }}
			>
				<dt className="flex items-center gap-1.5 font-mono text-xs text-[var(--sea-ink-soft)]">
					{entry.sensitive ? (
						<Lock
							size={12}
							aria-hidden="true"
							className="text-amber-700 dark:text-amber-300"
						/>
					) : null}
					{entry.key}
				</dt>
				<dd className="break-all font-mono text-xs text-[var(--sea-ink)]">
					{formatValue(entry.value)}
				</dd>
			</div>
			{entry.children.map((child) => (
				<SettingEntryRow
					key={`${entry.key}-${child.key}`}
					entry={child}
					depth={depth + 1}
				/>
			))}
		</>
	);
}

function AdminSettingsPage() {
	const settingsQuery = useQuery({
		queryKey: ["admin", "settings"],
		queryFn: requestAdminSettings,
	});

	const data = settingsQuery.data;

	return (
		<main className="page-wrap px-4 py-8 sm:py-10">
			<header className="mb-6">
				<p className="island-kicker mb-2">Admin</p>
				<h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
					Settings
				</h1>
				<p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
					Resolved runtime configuration. Edit{" "}
					<code className="rounded bg-black/5 px-1.5 py-0.5 text-xs">
						config.json
					</code>{" "}
					for runtime settings or{" "}
					<code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 text-xs">
						.env
					</code>{" "}
					for secrets and restart the backend to apply changes.
				</p>
			</header>

			{settingsQuery.isPending ? (
				<section className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center text-sm text-[var(--sea-ink-soft)]">
					Loading settings...
				</section>
			) : null}

			{settingsQuery.isError ? (
				<section className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
					{getApiErrorMessage(settingsQuery.error, "Failed to load settings.")}
				</section>
			) : null}

			{data ? (
				<>
					<section className="island-shell mb-6 grid gap-4 rounded-2xl p-5 shadow-sm sm:grid-cols-2">
						<SourceCard label="config.json" path={data.configPath} />
						<SourceCard label=".env" path={data.dotenvPath} />
					</section>

					<div className="grid gap-4 lg:grid-cols-2">
						{data.sections.map((section) => (
							<section
								key={section.title}
								className="island-shell rounded-2xl p-5 shadow-sm"
							>
								<header className="mb-4">
									<h2 className="text-lg font-semibold text-[var(--sea-ink)]">
										{section.title}
									</h2>
									{section.description ? (
										<p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
											{section.description}
										</p>
									) : null}
								</header>
								<dl className="divide-y divide-[var(--line)]">
									{section.entries.map((entry) => (
										<SettingEntryRow
											key={entry.key}
											entry={entry}
										/>
									))}
								</dl>
							</section>
						))}
					</div>

					<p className="mt-6 text-xs text-[var(--sea-ink-soft)]">
						Values marked with the lock icon are masked by keeping only the
						first and last characters. Secrets such as
						<code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 text-[10px]">
							JWT_SECRET
						</code>
						and
						<code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 text-[10px]">
							HF_TOKEN
						</code>
						use that same masking format.
					</p>
				</>
			) : null}
		</main>
	);
}

function SourceCard({ label, path }: { label: string; path: string | null }) {
	return (
		<div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3">
			<p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--sea-ink-soft)]">
				{label}
			</p>
			<p className="mt-1.5 break-all font-mono text-xs text-[var(--sea-ink)]">
				{path ?? "Unavailable"}
			</p>
		</div>
	);
}
