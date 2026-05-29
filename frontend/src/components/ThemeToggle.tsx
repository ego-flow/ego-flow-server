import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "#/components/ui/button";
import { THEME_STORAGE_KEY } from "#/constants/storage/storage-constants";
import {
	THEME_COLOR_SCHEME_QUERY,
	ThemeMode,
} from "#/constants/theme/theme-constants";
import { isThemeMode, resolveThemeMode } from "#/utils/theme";

function getInitialMode(): ThemeMode {
	if (typeof window === "undefined") {
		return ThemeMode.Auto;
	}

	const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
	if (isThemeMode(stored)) {
		return stored;
	}

	return ThemeMode.Auto;
}

function applyThemeMode(mode: ThemeMode) {
	const resolved = resolveThemeMode(mode);

	document.documentElement.classList.remove(ThemeMode.Light, ThemeMode.Dark);
	document.documentElement.classList.add(resolved);

	if (mode === ThemeMode.Auto) {
		document.documentElement.removeAttribute("data-theme");
	} else {
		document.documentElement.setAttribute("data-theme", mode);
	}

	document.documentElement.style.colorScheme = resolved;
}

export default function ThemeToggle() {
	const [mode, setMode] = useState<ThemeMode>(ThemeMode.Auto);

	useEffect(() => {
		const initialMode = getInitialMode();
		setMode(initialMode);
		applyThemeMode(initialMode);
	}, []);

	useEffect(() => {
		if (mode !== ThemeMode.Auto) {
			return;
		}

		const media = window.matchMedia(THEME_COLOR_SCHEME_QUERY);
		const onChange = () => applyThemeMode(ThemeMode.Auto);

		media.addEventListener("change", onChange);
		return () => {
			media.removeEventListener("change", onChange);
		};
	}, [mode]);

	function toggleMode() {
		const nextMode = mode === ThemeMode.Dark ? ThemeMode.Light : ThemeMode.Dark;
		setMode(nextMode);
		applyThemeMode(nextMode);
		window.localStorage.setItem(THEME_STORAGE_KEY, nextMode);
	}

	const isDarkMode = mode === ThemeMode.Dark;
	const label = isDarkMode ? "Switch to light mode" : "Switch to dark mode";

	return (
		<Button
			type="button"
			variant="outline"
			size="icon"
			onClick={toggleMode}
			aria-label={label}
			title={label}
		>
			{isDarkMode ? (
				<Sun size={16} aria-hidden="true" />
			) : (
				<Moon size={16} aria-hidden="true" />
			)}
		</Button>
	);
}
