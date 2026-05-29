export const parsePositiveInteger = (
	value: unknown,
	fallback: number,
	max?: number,
) => {
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed <= 0) {
		return fallback;
	}

	return typeof max === "number" ? Math.min(parsed, max) : parsed;
};

export const parseTrimmedString = (value: unknown) =>
	typeof value === "string" ? value.trim() : "";
