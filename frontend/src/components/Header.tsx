import { Link } from '@tanstack/react-router'
import { Database, LogOut, RadioTower, Settings, Shield, UserRound } from 'lucide-react'
import egoFlowIcon from '#/assets/EgoFlowIcon.png'
import ThemeToggle from '#/components/ThemeToggle'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/hooks/useAuth'

export default function Header() {
  const { isReady, isAuthenticated, logout, session } = useAuth()

  if (!isReady) {
    return null
  }

  const isAdmin = session?.user.role === 'admin'
  const identityLabel = session?.user.displayName || session?.user.id

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] backdrop-blur-lg">
      <nav className="page-full flex items-center justify-between px-10 py-4">
        <div className="flex items-center gap-3">
          <Link
            to={isAuthenticated ? '/videos' : '/login'}
            className="inline-flex items-center gap-2 text-lg font-bold text-[var(--sea-ink)] no-underline"
          >
            <img src={egoFlowIcon} alt="Ego Flow logo" className="h-6 w-6 object-contain" />
            <span>Ego Flow</span>
          </Link>
        </div>

        {isAuthenticated ? (
          <div className="ml-auto flex flex-wrap items-center justify-end gap-4 text-sm font-semibold sm:gap-6 sm:text-base">
            <Link
              to="/videos"
              className="inline-flex items-center gap-2 text-[var(--sea-ink-soft)] no-underline transition-colors hover:text-[var(--sea-ink)]"
            >
              <Database size={15} aria-hidden="true" />
              Videos
            </Link>
            <Link
              to="/live"
              className="inline-flex items-center gap-2 text-[var(--sea-ink-soft)] no-underline transition-colors hover:text-[var(--sea-ink)]"
            >
              <RadioTower size={15} aria-hidden="true" />
              Live
            </Link>
            {isAdmin ? (
              <>
                <Link
                  to="/admin/users"
                  className="inline-flex items-center gap-2 text-[var(--sea-ink-soft)] no-underline transition-colors hover:text-[var(--sea-ink)]"
                >
                  <Shield size={15} aria-hidden="true" />
                  Users
                </Link>
                <Link
                  to="/admin/settings"
                  className="inline-flex items-center gap-2 text-[var(--sea-ink-soft)] no-underline transition-colors hover:text-[var(--sea-ink)]"
                >
                  <Settings size={15} aria-hidden="true" />
                  Settings
                </Link>
              </>
            ) : null}
            <Link
              to="/profile"
              className="inline-flex items-center gap-2 text-[var(--sea-ink-soft)] no-underline transition-colors hover:text-[var(--sea-ink)]"
            >
              <UserRound size={15} aria-hidden="true" />
              Profile
            </Link>
            <div className="flex items-center gap-3">
              <span className="rounded-full border border-[var(--line)] bg-[var(--chip-bg)] px-3 py-1 text-xs text-[var(--sea-ink-soft)] sm:text-sm">
                {identityLabel}
              </span>
              <ThemeToggle />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => {
                  void logout()
                }}
                aria-label="Logout"
                title="Logout"
              >
                <LogOut size={16} aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </nav>
    </header>
  )
}
