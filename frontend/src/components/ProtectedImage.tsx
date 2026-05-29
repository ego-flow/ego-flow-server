import { useEffect, useState, type ReactNode } from 'react'

type ProtectedImageProps = {
  src: string | null
  alt: string
  className?: string
  fallback?: ReactNode
}

export default function ProtectedImage({
  src,
  alt,
  className,
  fallback = null,
}: ProtectedImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  useEffect(() => {
    setFailedSrc(null)
  }, [src])

  if (!src || failedSrc === src) {
    return <>{fallback}</>
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => {
        setFailedSrc(src)
      }}
    />
  )
}
