export const fallbackText = (
	value: string | null | undefined,
	fallback = "Unavailable",
) => (value?.trim() ? value : fallback);

export const contributorDisplayName = (
	contributor: {
		contributorDisplayName?: string | null;
		contributorUserId?: string | null;
		displayName?: string | null;
		userId?: string | null;
	} | null,
) =>
	fallbackText(
		contributor?.contributorDisplayName ??
			contributor?.displayName ??
			contributor?.contributorUserId ??
			contributor?.userId,
	);

export const repositoryDisplayName = (
	repository:
		| {
				ownerId?: string | null;
				name?: string | null;
				repositoryName?: string | null;
		  }
		| null
		| undefined,
	fallback = "Repository",
) => {
	const ownerId = repository?.ownerId?.trim();
	const repositoryName = (
		repository?.name ?? repository?.repositoryName
	)?.trim();

	if (ownerId && repositoryName) {
		return `${ownerId}/${repositoryName}`;
	}

	return fallbackText(repositoryName ?? ownerId, fallback);
};
