import { Clapperboard, Clock3, HardDrive } from 'lucide-react'
import { useState } from 'react'
import { cn } from '#/lib/utils'

interface VideoCardProps {
  title: string
  length: string
  size: string
  thumbnailUrl?: string
  className?: string
}

export default function VideoCard({
  title,
  length,
  size,
  thumbnailUrl,
  className,
}: VideoCardProps) {
  const [thumbnailFailed, setThumbnailFailed] = useState(false)
  const showThumbnail = Boolean(thumbnailUrl) && !thumbnailFailed

  return (
    <div
      className={cn(
        'group flex w-full max-w-md items-center gap-3 rounded-lg border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_88%,transparent)] p-3',
        'transition-colors transition-transform duration-200 hover:cursor-pointer hover:-translate-y-0.5 hover:border-[color-mix(in_oklab,var(--lagoon-deep)_38%,var(--line))]',
        className,
      )}
    >
      <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[var(--line)] bg-[color-mix(in_oklab,var(--card)_75%,var(--background))]">
        {showThumbnail ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="h-full w-full object-cover"
            onError={() => setThumbnailFailed(true)}
          />
        ) : (
          <Clapperboard size={18} className="text-[var(--sea-ink-soft)]" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-xs font-semibold tracking-[-0.02em] text-[var(--sea-ink)] transition-colors duration-200 group-hover:text-[var(--lagoon-deep)] md:text-sm">
          {title}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] leading-none text-[var(--sea-ink-soft)] md:text-[11px]">
          <span className="inline-flex items-center gap-1.5">
            <Clock3 size={12} className="md:size-[13px]" aria-hidden="true" />
            {length}
          </span>
          <span aria-hidden="true">•</span>
          <span className="inline-flex items-center gap-1.5">
            <HardDrive size={12} className="md:size-[13px]" aria-hidden="true" />
            {size}
          </span>
        </div>
      </div>
    </div>
  )
}
