import { Navigate, createFileRoute } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/hooks/useAuth'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const { isReady, isAuthenticated, logout, session } = useAuth()

  if (!isReady) {
    return null
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" />
  }

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
