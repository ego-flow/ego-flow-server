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
        'group block w-full cursor-pointer rounded-xl border border-[#2a2e36] bg-gradient-to-r from-[#16181d] via-[#121419] to-[#0e1014] px-5 py-4 shadow-[0_8px_28px_rgba(0,0,0,0.34)] no-underline',
        'transition-colors transition-transform duration-200 hover:-translate-y-0.5 hover:border-[#3a3f49]',
        className,
      )}
    >
      <p className="mb-2 flex items-center gap-2.5 leading-none font-semibold tracking-[-0.02em] text-[#e3e8f4]">
        <Database size={16} className="text-[#8d929e] md:size-[18px]" aria-hidden="true" />
        <span className="font-mono text-xs transition-colors duration-200 group-hover:text-[#f7d66b] md:text-base">
          {fullName}
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-2.5 text-[11px] leading-none text-[#a3a8b3] md:text-xs">
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
