import {
	THEME_COLOR_SCHEME_QUERY,
	ThemeMode,
} from "#/constants/theme/theme-constants";

export const isThemeMode = (value: unknown): value is ThemeMode =>
	value === ThemeMode.Light ||
	value === ThemeMode.Dark ||
	value === ThemeMode.Auto;

export const resolveThemeMode = (mode: ThemeMode) => {
	const prefersDark = window.matchMedia(THEME_COLOR_SCHEME_QUERY).matches;
	return mode === ThemeMode.Auto
		? prefersDark
			? ThemeMode.Dark
			: ThemeMode.Light
		: mode;
};
