import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { requestAdminSettings } from '#/api/admin'
import { getApiErrorMessage } from '#/api/client'

export const Route = createFileRoute('/admin/settings')({
  component: AdminSettingsPage,
})

function AdminSettingsPage() {
  const settingsQuery = useQuery({
    queryKey: ['admin', 'settings'],
    queryFn: requestAdminSettings,
  })

  return (
    <main className="page-wrap px-4 py-8 sm:py-10">
      <header className="mb-6">
        <p className="island-kicker mb-2">Admin</p>
        <h1 className="display-title text-3xl font-bold text-[var(--sea-ink)] sm:text-4xl">
          Settings
        </h1>
        <p className="mt-2 text-sm text-[var(--sea-ink-soft)] sm:text-base">
          The dataset target directory is fixed when the server boots.
        </p>
      </header>

      <section className="island-shell space-y-4 rounded-2xl p-5 shadow-sm">
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-[var(--sea-ink)]">Current target directory</h2>
          <p className="rounded-xl border border-[var(--line)] bg-[var(--card-bg)] px-4 py-3 font-mono text-sm text-[var(--sea-ink)]">
            {settingsQuery.data?.targetDirectory ?? 'Unavailable'}
          </p>
        </div>

        <div className="space-y-2 text-sm text-[var(--sea-ink-soft)]">
          <p>To change this path, update the server `config.json` file and restart the backend.</p>
          <p>When the configured path changes on boot, EgoFlow migrates existing generated datasets to the new directory automatically.</p>
        </div>

        {settingsQuery.isPending ? (
          <p className="text-sm text-[var(--sea-ink-soft)]">Loading settings...</p>
        ) : null}

        {settingsQuery.isError ? (
          <p className="text-sm text-red-700 dark:text-red-300">
            {getApiErrorMessage(settingsQuery.error, 'Failed to load settings.')}
          </p>
        ) : null}
      </section>
    </main>
  )
}
