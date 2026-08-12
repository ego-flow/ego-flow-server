export function parseRepositoryTags(value: string) {
	const uniqueTags = new Map<string, string>();

	for (const rawTag of value.split(",")) {
		const tag = rawTag.trim().replace(/^#+/, "").trim();

		if (!tag) {
			continue;
		}

		const key = tag.toLowerCase();
		if (!uniqueTags.has(key)) {
			uniqueTags.set(key, tag.slice(0, 40));
		}
	}

	return Array.from(uniqueTags.values()).slice(0, 20);
}

export function formatRepositoryTags(tags: string[]) {
	return tags.join(", ");
}

export function repositoryTagsMatchQuery(tags: string[], query: string) {
	const normalizedQuery = query.trim().replace(/^#+/, "").trim().toLowerCase();

	if (!normalizedQuery) {
		return true;
	}

	return tags.some((tag) => tag.toLowerCase().includes(normalizedQuery));
}
