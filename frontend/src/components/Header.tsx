import { Link } from '@tanstack/react-router'
import { Database, LogOut, UserRound } from 'lucide-react'
import egoFlowIcon from '#/assets/EgoFlowIcon.png'
import ThemeToggle from '#/components/ThemeToggle'
import { Button } from '#/components/ui/button'
import { useAuth } from '#/hooks/useAuth'

export default function Header() {
  const { isReady, isAuthenticated, logout } = useAuth()

  if (!isReady) {
    return null
  }

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] backdrop-blur-lg">
      <nav className="page-full flex items-center justify-between px-10 py-4">
        <div className="flex items-center gap-3">
          <Link
            to={isAuthenticated ? '/repositories' : '/login'}
            className="inline-flex items-center gap-2 text-lg font-bold text-[var(--sea-ink)] no-underline"
          >
            <img src={egoFlowIcon} alt="Ego Flow logo" className="h-6 w-6 object-contain" />
            <span>Ego Flow</span>
          </Link>
        </div>

        {isAuthenticated ? (
          <div className="ml-auto flex items-center gap-8 text-base font-semibold">
            <Link
              to="/repositories"
              className="inline-flex items-center gap-2 text-[var(--sea-ink-soft)] no-underline transition-colors hover:text-[var(--sea-ink)]"
            >
              <Database size={15} aria-hidden="true" />
              Repositories
            </Link>
            <Link
              to="/profile"
              className="inline-flex items-center gap-2 text-[var(--sea-ink-soft)] no-underline transition-colors hover:text-[var(--sea-ink)]"
            >
              <UserRound size={15} aria-hidden="true" />
              Profile
            </Link>
            <div className="flex items-center gap-4">
              <ThemeToggle />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={logout}
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
