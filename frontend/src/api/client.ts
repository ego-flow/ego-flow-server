import axios from "axios";
import {
	API_JSON_CONTENT_TYPE,
	DEFAULT_API_BASE_URL,
	DEFAULT_BACKEND_ORIGIN,
} from "#/constants/api/api-constants";
import { HTTP_URL_PATTERN } from "#/constants/api/url-constants";

type ApiErrorResponse = {
	error?: {
		code?: string;
		message?: string;
		details?: unknown;
	};
	message?: string;
};

function getConfiguredApiBaseUrl() {
	const configured = import.meta.env.VITE_API_BASE_URL;

	return typeof configured === "string" && configured.trim()
		? configured.trim()
		: DEFAULT_API_BASE_URL;
}

export function getBackendOrigin() {
	const configuredOrigin = import.meta.env.VITE_BACKEND_ORIGIN;

	if (typeof configuredOrigin === "string" && configuredOrigin.trim()) {
		return configuredOrigin.trim().replace(/\/$/, "");
	}

	if (typeof window !== "undefined" && window.location?.origin) {
		return window.location.origin;
	}

	try {
		return new URL(getConfiguredApiBaseUrl()).origin;
	} catch {
		return DEFAULT_BACKEND_ORIGIN;
	}
}

export function resolveBackendUrl(path: string | null) {
	if (!path) {
		return null;
	}

	if (HTTP_URL_PATTERN.test(path)) {
		return path;
	}

	if (path.startsWith("/")) {
		return path;
	}

	return new URL(path, `${getBackendOrigin()}/`).toString();
}

export const apiClient = axios.create({
	baseURL: getConfiguredApiBaseUrl(),
	withCredentials: true,
	headers: {
		"Content-Type": API_JSON_CONTENT_TYPE,
	},
});

export function getApiErrorMessage(error: unknown, fallbackMessage: string) {
	if (axios.isAxiosError<ApiErrorResponse>(error)) {
		if (
			typeof error.response?.data?.error?.message === "string" &&
			error.response.data.error.message
		) {
			return error.response.data.error.message;
		}

		if (
			typeof error.response?.data?.message === "string" &&
			error.response.data.message
		) {
			return error.response.data.message;
		}

		if (typeof error.message === "string" && error.message) {
			return error.message;
		}
	}

	if (error instanceof Error && error.message) {
		return error.message;
	}

	return fallbackMessage;
}
