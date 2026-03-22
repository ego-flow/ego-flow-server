import axios from 'axios'

import { readStoredAuthSession, replaceStoredAuthToken } from '#/lib/auth-session'

type ApiErrorResponse = {
  message?: string
}

const DEFAULT_API_BASE_URL = 'http://127.0.0.1:3000/api/v1'

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

  try {
    return new URL(getConfiguredApiBaseUrl()).origin
  } catch {
    return 'http://127.0.0.1:3000'
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
  headers: {
    'Content-Type': 'application/json',
  },
})

apiClient.interceptors.request.use((config) => {
  const session = readStoredAuthSession()
  if (!session?.token) {
    return config
  }

  config.headers.Authorization = `Bearer ${session.token}`
  return config
})

apiClient.interceptors.response.use((response) => {
  const refreshedToken = response.headers['x-refreshed-token']

  if (typeof refreshedToken === 'string' && refreshedToken) {
    replaceStoredAuthToken(refreshedToken)
  }

  return response
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
