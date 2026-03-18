import { Clock3, Database, HardDrive } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { cn } from '#/lib/utils'

interface RepositoryCardProps {
  userId: string
  repoName: string
  updatedText: string
  size: string
  length: string
  className?: string
}

export default function RepositoryCard({
  userId,
  repoName,
  updatedText,
  size,
  length,
  className,
}: RepositoryCardProps) {
  const fullName = `${userId}/${repoName}`

  return (
    <Link
      to="/repositories/$userId/$repoName"
      params={{ userId, repoName }}
      className={cn(
        'group block w-full cursor-pointer rounded-xl border border-[var(--line)] bg-gradient-to-r from-[color-mix(in_oklab,var(--card)_90%,transparent)] via-[color-mix(in_oklab,var(--card)_84%,transparent)] to-[color-mix(in_oklab,var(--card)_78%,var(--background))] px-5 py-4 no-underline',
        'transition-colors transition-transform duration-200 hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--lagoon-deep)_38%,var(--line))]',
        className,
      )}
    >
      <p className="mb-2 flex items-center gap-2.5 leading-none font-semibold tracking-[-0.02em] text-[var(--sea-ink)]">
        <Database size={16} className="text-[var(--sea-ink-soft)] md:size-[18px]" aria-hidden="true" />
        <span className="font-mono text-xs transition-colors duration-200 group-hover:text-[var(--lagoon-deep)] md:text-base">
          {fullName}
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-2.5 text-[11px] leading-none text-[var(--sea-ink-soft)] md:text-xs">
        <span>{updatedText}</span>
        <span aria-hidden="true">•</span>
        <span className="inline-flex items-center gap-1.5">
          <HardDrive size={14} className="md:size-4" aria-hidden="true" />
          {size}
        </span>
        <span aria-hidden="true">•</span>
        <span className="inline-flex items-center gap-1.5">
          <Clock3 size={14} className="md:size-4" aria-hidden="true" />
          {length}
        </span>
      </div>
    </Link>
  )
}
