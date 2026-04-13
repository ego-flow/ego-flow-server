import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate, createFileRoute } from '@tanstack/react-router'

import {
  requestCreateToken,
  requestCurrentToken,
  requestRevokeToken,
} from '#/api/tokens'
import { getApiErrorMessage } from '#/api/client'
import { formatDateTime } from '#/api/videos'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useAuth } from '#/hooks/useAuth'
import { requestChangeMyPassword } from '#/lib/auth'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const queryClient = useQueryClient()
  const { isReady, isAuthenticated, logout, session } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [tokenName, setTokenName] = useState('python-package')
  const [issuedToken, setIssuedToken] = useState<{
    name: string
    token: string
    createdAt: string
    rotatedPrevious: boolean
  } | null>(null)
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

  const currentTokenQuery = useQuery({
    queryKey: ['auth', 'token'],
    queryFn: requestCurrentToken,
  })

  const changePasswordMutation = useMutation({
    mutationFn: () =>
      requestChangeMyPassword({
        currentPassword,
        newPassword,
      }),
    onSuccess: (response) => {
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setSuccessMessage(response.message)
    },
    onError: () => {
      setSuccessMessage(null)
    },
  })

  const createTokenMutation = useMutation({
    mutationFn: () => requestCreateToken(tokenName.trim()),
    onSuccess: async (response) => {
      setIssuedToken({
        name: response.name,
        token: response.token,
        createdAt: response.createdAt,
        rotatedPrevious: response.rotatedPrevious,
      })
      setCopyFeedback(null)
      await queryClient.invalidateQueries({ queryKey: ['auth', 'token'] })
    },
  })

  const revokeTokenMutation = useMutation({
    mutationFn: (tokenId: string) => requestRevokeToken(tokenId),
    onSuccess: async () => {
      setIssuedToken(null)
      setCopyFeedback(null)
      await queryClient.invalidateQueries({ queryKey: ['auth', 'token'] })
    },
  })

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  const isPasswordMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword
  const currentToken = currentTokenQuery.data?.token ?? null

  return (
    <main className="page-wrap relative px-4 py-10">
      <section className="island-shell mx-auto max-w-2xl rounded-2xl p-6 shadow-xl sm:p-8">
        <p className="island-kicker mb-2">Profile</p>
        <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          {session?.user.displayName || session?.user.id}
        </h1>
        <div className="mt-6 grid gap-3 text-sm text-[var(--sea-ink-soft)] sm:text-base">
          <div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3">
            <span className="font-semibold text-[var(--sea-ink)]">User ID:</span>{' '}
            {session?.user.id}
          </div>
          <div className="rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-3">
            <span className="font-semibold text-[var(--sea-ink)]">Role:</span>{' '}
            {session?.user.role}
          </div>
        </div>

        <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--chip-bg)] p-5">
          <h2 className="text-lg font-semibold text-[var(--sea-ink)]">Change password</h2>
          <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
            Enter your current password and set a new password with at least 8
            characters.
          </p>

          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              setSuccessMessage(null)
              changePasswordMutation.mutate()
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </div>

            {isPasswordMismatch ? (
              <p className="text-sm text-red-700 dark:text-red-300">
                New password confirmation does not match.
              </p>
            ) : null}

            {changePasswordMutation.isError ? (
              <p className="text-sm text-red-700 dark:text-red-300">
                {getApiErrorMessage(
                  changePasswordMutation.error,
                  'Failed to change password.',
                )}
              </p>
            ) : null}

            {successMessage ? (
              <p className="text-sm text-emerald-700 dark:text-emerald-300">
                {successMessage}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={
                changePasswordMutation.isPending ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword ||
                isPasswordMismatch
              }
            >
              Change password
            </Button>
          </form>
        </section>

        <section className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--chip-bg)] p-5">
          <h2 className="text-lg font-semibold text-[var(--sea-ink)]">API token</h2>
          <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">
            Use this token with the EgoFlow Python package via the
            <code className="mx-1 rounded bg-black/5 px-1.5 py-0.5 text-xs">EGOFLOW_TOKEN</code>
            environment variable.
          </p>

          <form
            className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              setCopyFeedback(null)
              setIssuedToken(null)
              createTokenMutation.mutate()
            }}
          >
            <div className="flex-1 space-y-2">
              <Label htmlFor="token-name">Token name</Label>
              <Input
                id="token-name"
                value={tokenName}
                maxLength={100}
                onChange={(event) => setTokenName(event.target.value)}
                placeholder="python-package"
              />
            </div>

            <Button
              type="submit"
              disabled={createTokenMutation.isPending || !tokenName.trim()}
            >
              {currentToken ? 'Rotate token' : 'Issue token'}
            </Button>
          </form>

          {createTokenMutation.isError ? (
            <p className="mt-4 text-sm text-red-700 dark:text-red-300">
              {getApiErrorMessage(createTokenMutation.error, 'Failed to issue token.')}
            </p>
          ) : null}

          {currentTokenQuery.isPending ? (
            <div className="mt-5 rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-sm text-[var(--sea-ink-soft)]">
              Loading current token...
            </div>
          ) : currentTokenQuery.isError ? (
            <div className="mt-5 rounded-xl border border-red-500/25 bg-red-500/6 px-4 py-4 text-sm text-red-700 dark:text-red-300">
              {getApiErrorMessage(currentTokenQuery.error, 'Failed to load token status.')}
            </div>
          ) : currentToken ? (
            <div className="mt-5 rounded-xl border border-[var(--line)] bg-white/60 px-4 py-4">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="space-y-2 text-sm text-[var(--sea-ink-soft)]">
                  <p className="font-semibold text-[var(--sea-ink)]">Current token: issued</p>
                  <p>
                    <span className="font-semibold text-[var(--sea-ink)]">Name:</span>{' '}
                    {currentToken.name}
                  </p>
                  <p>
                    <span className="font-semibold text-[var(--sea-ink)]">Created:</span>{' '}
                    {formatDateTime(currentToken.createdAt)}
                  </p>
                  <p>
                    <span className="font-semibold text-[var(--sea-ink)]">Last used:</span>{' '}
                    {formatDateTime(currentToken.lastUsedAt)}
                  </p>
                </div>

                <Button
                  type="button"
                  variant="destructive"
                  disabled={revokeTokenMutation.isPending}
                  onClick={() => {
                    if (!window.confirm('Revoke the current API token?')) {
                      return
                    }

                    revokeTokenMutation.mutate(currentToken.id)
                  }}
                >
                  Revoke
                </Button>
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-[var(--line)] px-4 py-6 text-sm text-[var(--sea-ink-soft)]">
              No active API token has been issued yet.
            </div>
          )}

          {revokeTokenMutation.isError ? (
            <p className="mt-4 text-sm text-red-700 dark:text-red-300">
              {getApiErrorMessage(revokeTokenMutation.error, 'Failed to revoke token.')}
            </p>
          ) : null}

          <div className="mt-4 space-y-2 text-sm text-[var(--sea-ink-soft)]">
            <p>Token values are shown only once right after issuance.</p>
            <p>Issuing a new token immediately invalidates the previous one.</p>
          </div>
        </section>

        <div className="mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              void logout()
            }}
          >
            Log out
          </Button>
        </div>
      </section>

      {issuedToken ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <section className="island-shell w-full max-w-xl rounded-2xl p-6 shadow-xl">
            <p className="island-kicker mb-2">API Token</p>
            <h2 className="text-2xl font-semibold text-[var(--sea-ink)]">
              Copy this token now
            </h2>
            <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
              This is the only time EgoFlow will show the raw token value.
            </p>

            <div className="mt-5 rounded-xl border border-[var(--line)] bg-[var(--chip-bg)] px-4 py-4">
              <p className="text-sm text-[var(--sea-ink-soft)]">
                <span className="font-semibold text-[var(--sea-ink)]">Name:</span>{' '}
                {issuedToken.name}
              </p>
              <p className="mt-2 text-sm text-[var(--sea-ink-soft)]">
                <span className="font-semibold text-[var(--sea-ink)]">Created:</span>{' '}
                {formatDateTime(issuedToken.createdAt)}
              </p>
              <pre className="mt-4 overflow-x-auto rounded-lg bg-slate-950 px-4 py-3 text-sm text-slate-100">
                {issuedToken.token}
              </pre>
            </div>

            {issuedToken.rotatedPrevious ? (
              <p className="mt-4 text-sm text-amber-700 dark:text-amber-300">
                The previous token has already been invalidated.
              </p>
            ) : null}

            {copyFeedback ? (
              <p className="mt-4 text-sm text-[var(--sea-ink-soft)]">{copyFeedback}</p>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issuedToken.token)
                    setCopyFeedback('Token copied to clipboard.')
                  } catch {
                    setCopyFeedback('Clipboard copy failed. Copy the token manually.')
                  }
                }}
              >
                Copy token
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setIssuedToken(null)
                  setCopyFeedback(null)
                }}
              >
                Close
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  )
}
