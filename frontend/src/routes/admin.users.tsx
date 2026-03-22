import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import {
  requestAdminUsers,
  requestCreateUser,
  requestDeleteUser,
  requestResetUserPassword,
} from '#/api/admin'
import { getApiErrorMessage } from '#/api/client'
import { formatDateTime } from '#/api/videos'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

export const Route = createFileRoute('/admin/users')({
  component: AdminUsersPage,
})

function AdminUsersPage() {
  const queryClient = useQueryClient()
  const [newUserId, setNewUserId] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [displayName, setDisplayName] = useState('')

  const usersQuery = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: requestAdminUsers,
  })

  const createUserMutation = useMutation({
    mutationFn: () =>
      requestCreateUser({
        id: newUserId.trim(),
        password: newPassword,
        displayName: displayName.trim(),
      }),
    onSuccess: async () => {
      setNewUserId('')
      setNewPassword('')
      setDisplayName('')
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })

  const resetPasswordMutation = useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      requestResetUserPassword(userId, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })

  const deleteUserMutation = useMutation({
    mutationFn: (userId: string) => requestDeleteUser(userId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <header className="mb-6">
        <p className="island-kicker mb-2">Admin</p>
        <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          Users
        </h1>
        <p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
          Create users, deactivate inactive accounts, and reset passwords.
        </p>
      </header>

      <section className="island-shell rounded-2xl p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-[var(--sea-ink)]">Create user</h2>
        <form
          className="mt-4 grid gap-4 md:grid-cols-3"
          onSubmit={(event) => {
            event.preventDefault()
            createUserMutation.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="new-user-id">User ID</Label>
            <Input
              id="new-user-id"
              value={newUserId}
              onChange={(event) => setNewUserId(event.target.value)}
              placeholder="alice"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-password">Password</Label>
            <Input
              id="new-user-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              placeholder="At least 8 characters"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-user-display-name">Display name</Label>
            <Input
              id="new-user-display-name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="md:col-span-3">
            <Button
              type="submit"
              disabled={
                createUserMutation.isPending ||
                !newUserId.trim() ||
                newPassword.length < 8
              }
            >
              Create user
            </Button>
          </div>
        </form>

        {createUserMutation.isError ? (
          <p className="mt-4 text-sm text-red-700 dark:text-red-300">
            {getApiErrorMessage(createUserMutation.error, 'Failed to create user.')}
          </p>
        ) : null}
      </section>

      <section className="mt-6 space-y-4">
        {usersQuery.isPending ? (
          <div className="rounded-2xl border border-dashed border-[var(--line)] px-6 py-12 text-center text-[var(--sea-ink-soft)]">
            Loading users...
          </div>
        ) : usersQuery.isError ? (
          <div className="rounded-2xl border border-red-500/25 bg-red-500/6 px-6 py-5 text-sm text-red-700 dark:text-red-300">
            {getApiErrorMessage(usersQuery.error, 'Failed to load users.')}
          </div>
        ) : (
          usersQuery.data?.map((user) => (
            <article
              key={user.id}
              className="island-shell rounded-2xl p-5 shadow-sm"
            >
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-semibold text-[var(--sea-ink)]">
                      {user.displayName || user.id}
                    </h2>
                    <span className="rounded-full bg-[var(--chip-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--sea-ink-soft)]">
                      {user.role}
                    </span>
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        user.isActive
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-500/12 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {user.isActive ? 'active' : 'inactive'}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--sea-ink-soft)]">{user.id}</p>
                  <p className="mt-3 text-sm text-[var(--sea-ink-soft)]">
                    Created {formatDateTime(user.createdAt)}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      const nextPassword = window.prompt(
                        `Enter a new password for ${user.id}`,
                      )

                      if (!nextPassword) {
                        return
                      }

                      resetPasswordMutation.mutate({
                        userId: user.id,
                        password: nextPassword,
                      })
                    }}
                    disabled={resetPasswordMutation.isPending}
                  >
                    Reset password
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={
                      deleteUserMutation.isPending || user.role === 'admin' || !user.isActive
                    }
                    onClick={() => {
                      if (!window.confirm(`Deactivate ${user.id}?`)) {
                        return
                      }

                      deleteUserMutation.mutate(user.id)
                    }}
                  >
                    Deactivate
                  </Button>
                </div>
              </div>
            </article>
          ))
        )}

        {resetPasswordMutation.isError ? (
          <p className="text-sm text-red-700 dark:text-red-300">
            {getApiErrorMessage(
              resetPasswordMutation.error,
              'Failed to reset password.',
            )}
          </p>
        ) : null}

        {deleteUserMutation.isError ? (
          <p className="text-sm text-red-700 dark:text-red-300">
            {getApiErrorMessage(deleteUserMutation.error, 'Failed to deactivate user.')}
          </p>
        ) : null}
      </section>
    </main>
  )
}
