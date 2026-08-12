import { Link } from '@tanstack/react-router'

export default function NotFound() {
  return (
    <main className="page-wrap grid min-h-[calc(100dvh-5rem)] place-items-center px-4 py-12">
      <section className="island-shell w-full max-w-lg rounded-2xl p-8 text-center shadow-xl">
        <p className="island-kicker mb-2">Error 404</p>
        <h1 className="display-title text-4xl font-bold text-[var(--sea-ink)] sm:text-5xl">
          Page Not Found
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--sea-ink-soft)] sm:text-base">
          The page you requested does not exist or may have been moved.
        </p>

        <div className="mt-7 flex items-center justify-center gap-3">
          <Link
            to="/"
            className="rounded-lg bg-[var(--lagoon-deep)] px-4 py-2 text-sm font-semibold text-white no-underline transition-opacity hover:opacity-90"
          >
            Go Home
          </Link>
          <Link
            to="/login"
            className="rounded-lg border border-[var(--line)] px-4 py-2 text-sm font-semibold text-[var(--sea-ink)] no-underline transition-colors hover:bg-[var(--link-bg-hover)]"
          >
            Log In
          </Link>
        </div>
      </section>
    </main>
  )
}
