export const readSessionJson = <T>(key: string, fallback: T): T => {
	if (typeof window === "undefined") {
		return fallback;
	}

	try {
		const rawValue = window.sessionStorage.getItem(key);
		return rawValue ? (JSON.parse(rawValue) as T) : fallback;
	} catch {
		return fallback;
	}
};

export const writeSessionJson = <T>(key: string, value: T) => {
	if (typeof window === "undefined") {
		return;
	}

	window.sessionStorage.setItem(key, JSON.stringify(value));
};
