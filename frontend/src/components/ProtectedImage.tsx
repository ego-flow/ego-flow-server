import { useEffect, useState, type ReactNode } from 'react'

type ProtectedImageProps = {
  src: string | null
  authToken?: string | null
  alt: string
  className?: string
  fallback?: ReactNode
}

export default function ProtectedImage({
  src,
  authToken,
  alt,
  className,
  fallback = null,
}: ProtectedImageProps) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!src) {
      setObjectUrl(null)
      return
    }

    if (!authToken) {
      setObjectUrl(src)
      return
    }

    const controller = new AbortController()
    let nextObjectUrl: string | null = null

    const loadImage = async () => {
      try {
        const response = await fetch(src, {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
          signal: controller.signal,
        })

        if (!response.ok) {
          throw new Error(`Failed to load image: ${response.status}`)
        }

        const blob = await response.blob()
        nextObjectUrl = URL.createObjectURL(blob)
        setObjectUrl(nextObjectUrl)
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        console.error(error)
        setObjectUrl(null)
      }
    }

    setObjectUrl(null)
    void loadImage()

    return () => {
      controller.abort()
      if (nextObjectUrl) {
        URL.revokeObjectURL(nextObjectUrl)
      }
    }
  }, [authToken, src])

  if (!objectUrl) {
    return <>{fallback}</>
  }

  return <img src={objectUrl} alt={alt} className={className} />
}
