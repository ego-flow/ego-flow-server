import { Link } from '@tanstack/react-router'
import { Database, UserRound } from 'lucide-react'
import egoFlowIcon from '#/assets/EgoFlowIcon.png'

export default function Header() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--header-bg)] backdrop-blur-lg">
      <nav className="page-full flex items-center justify-between px-10 py-4">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-lg font-bold text-[var(--sea-ink)] no-underline"
        >
          <img src={egoFlowIcon} alt="Ego Flow logo" className="h-6 w-6 object-contain" />
          <span>Ego Flow</span>
        </Link>

        <div className="flex items-center gap-13 px-5 text-base font-semibold">
          <a
            href="/repositories"
            className="inline-flex items-center gap-2 text-[var(--sea-ink-soft)] no-underline transition-colors hover:text-[var(--sea-ink)]"
          >
            <Database size={15} aria-hidden="true" />
            Repositories
          </a>
          <a
            href="/profile"
            className="inline-flex items-center gap-2 text-[var(--sea-ink-soft)] no-underline transition-colors hover:text-[var(--sea-ink)]"
          >
            <UserRound size={15} aria-hidden="true" />
            Profile
          </a>
        </div>
      </nav>
    </header>
  )
}
