import axios from 'axios'

type ApiErrorResponse = {
  message?: string
}

const DEFAULT_API_BASE_URL = '/api/v1'

function getConfiguredApiBaseUrl() {
  const configured = import.meta.env.VITE_API_BASE_URL

  return typeof configured === 'string' && configured.trim()
    ? configured.trim()
    : DEFAULT_API_BASE_URL
}

export function getBackendOrigin() {
  const configuredOrigin = import.meta.env.VITE_BACKEND_ORIGIN

  if (typeof configuredOrigin === 'string' && configuredOrigin.trim()) {
    return configuredOrigin.trim().replace(/\/$/, '')
  }

  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }

  try {
    return new URL(getConfiguredApiBaseUrl()).origin
  } catch {
    return 'http://127.0.0.1'
  }
}

export function resolveBackendUrl(path: string | null) {
  if (!path) {
    return null
  }

  if (/^https?:\/\//.test(path)) {
    return path
  }

  return new URL(path, `${getBackendOrigin()}/`).toString()
}

export const apiClient = axios.create({
  baseURL: getConfiguredApiBaseUrl(),
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

export function getApiErrorMessage(error: unknown, fallbackMessage: string) {
  if (axios.isAxiosError<ApiErrorResponse>(error)) {
    if (typeof error.response?.data?.message === 'string' && error.response.data.message) {
      return error.response.data.message
    }

    if (typeof error.message === 'string' && error.message) {
      return error.message
    }
  }

  if (error instanceof Error && error.message) {
    return error.message
  }

  return fallbackMessage
}
