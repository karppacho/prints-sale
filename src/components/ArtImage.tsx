import { useSignedUrl } from '../lib/images'

export default function ArtImage({
  path,
  alt,
  className,
}: {
  path: string | null
  alt: string
  className?: string
}) {
  const url = useSignedUrl(path)
  if (!path || !url) {
    return (
      <div className={`bg-gray-200 flex items-center justify-center text-2xl ${className ?? ''}`}>
        🖼️
      </div>
    )
  }
  return <img src={url} alt={alt} loading="lazy" className={`object-cover ${className ?? ''}`} />
}
