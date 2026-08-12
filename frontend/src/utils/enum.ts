export const parseEnumValue = <
	T extends Record<string, string>,
	F extends string,
>(
	enumValues: T,
	value: unknown,
	fallback: T[keyof T] | F,
): T[keyof T] | F => {
	if (typeof value !== "string") {
		return fallback;
	}

	return (Object.values(enumValues) as string[]).includes(value)
		? (value as T[keyof T])
		: fallback;
};
