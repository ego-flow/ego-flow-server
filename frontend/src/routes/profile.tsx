import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Navigate, createFileRoute } from '@tanstack/react-router'

import { getApiErrorMessage } from '#/api/client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useAuth } from '#/hooks/useAuth'
import { requestChangeMyPassword } from '#/lib/auth'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const { isReady, isAuthenticated, logout, session } = useAuth()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

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

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

  const isPasswordMismatch =
    confirmPassword.length > 0 && newPassword !== confirmPassword

  return (
    <main className="page-wrap px-4 py-10">
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
    </main>
  )
}
