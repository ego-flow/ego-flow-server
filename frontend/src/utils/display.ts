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
