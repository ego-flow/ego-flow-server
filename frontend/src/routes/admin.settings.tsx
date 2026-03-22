import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import {
  requestAdminSettings,
  requestUpdateTargetDirectory,
} from '#/api/admin'
import { getApiErrorMessage } from '#/api/client'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
})

function AdminSettingsPage() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: requestAdminSettings,
  })
  const [targetDirectory, setTargetDirectory] = useState('')

  useEffect(() => {
    if (typeof settingsQuery.data?.targetDirectory === 'string') {
      setTargetDirectory(settingsQuery.data.targetDirectory)
    }
  }, [settingsQuery.data?.targetDirectory])

  const updateMutation = useMutation({
    mutationFn: () => requestUpdateTargetDirectory(targetDirectory.trim()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })
    },
  })

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <header className="mb-6">
        <p className="island-kicker mb-2">Admin</p>
        <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          Settings
        </h1>
        <p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
          Configure the final target directory used for new ingest sessions.
        </p>
      </header>

      <section className="island-shell rounded-2xl p-5 shadow-sm">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            updateMutation.mutate()
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="target-directory">Target directory</Label>
            <Input
              id="target-directory"
              value={targetDirectory}
              onChange={(event) => setTargetDirectory(event.target.value)}
              placeholder="/data/datasets"
            />
          </div>

          <div className="flex items-center gap-3">
            <Button
              type="submit"
              disabled={updateMutation.isPending || !targetDirectory.trim().startsWith('/')}
            >
              Save
            </Button>
            {settingsQuery.data?.targetDirectory ? (
              <span className="text-sm text-[var(--sea-ink-soft)]">
                Current: {settingsQuery.data.targetDirectory}
              </span>
            ) : null}
          </div>
        </form>

        {settingsQuery.isPending ? (
          <p className="mt-4 text-sm text-[var(--sea-ink-soft)]">Loading settings...</p>
        ) : null}

        {settingsQuery.isError ? (
          <p className="mt-4 text-sm text-red-700 dark:text-red-300">
            {getApiErrorMessage(settingsQuery.error, 'Failed to load settings.')}
          </p>
        ) : null}

        {updateMutation.isError ? (
          <p className="mt-4 text-sm text-red-700 dark:text-red-300">
            {getApiErrorMessage(updateMutation.error, 'Failed to update target directory.')}
          </p>
        ) : null}
      </section>
    </main>
  )
}
