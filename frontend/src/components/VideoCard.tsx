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
        'group flex w-full max-w-md items-center gap-3 rounded-lg border border-[#2a2e36] bg-[#121419] p-3 shadow-[0_8px_28px_rgba(0,0,0,0.34)]',
        'transition-colors transition-transform duration-200 hover:cursor-pointer hover:-translate-y-0.5 hover:border-[#3a3f49]',
        className,
      )}
    >
      <div className="flex h-12 w-20 shrink-0 items-center justify-center overflow-hidden rounded-md border border-[#2a2e36] bg-[#0f1217]">
        {showThumbnail ? (
          <img
            src={thumbnailUrl}
            alt={title}
            className="h-full w-full object-cover"
            onError={() => setThumbnailFailed(true)}
          />
        ) : (
          <Clapperboard size={18} className="text-[#8d929e]" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0">
        <p className="truncate text-xs font-semibold tracking-[-0.02em] text-[#e3e8f4] md:text-sm">
          {title}
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px] leading-none text-[#a3a8b3] md:text-[11px]">
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
