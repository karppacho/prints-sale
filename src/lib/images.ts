import { useEffect, useState } from 'react'
import { supabase } from './supabase'

const TTL_SEC = 3600
const cache = new Map<string, { url: string; expiresAt: number }>()

/** Подписанный URL фото из приватного bucket art-images (с кэшем) */
export async function getSignedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path)
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.url
  const { data, error } = await supabase.storage
    .from('art-images')
    .createSignedUrl(path, TTL_SEC)
  if (error || !data) return null
  cache.set(path, { url: data.signedUrl, expiresAt: Date.now() + TTL_SEC * 1000 })
  return data.signedUrl
}

export function useSignedUrl(path: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let stale = false
    setUrl(null)
    if (path) {
      void getSignedUrl(path).then((u) => {
        if (!stale) setUrl(u)
      })
    }
    return () => {
      stale = true
    }
  }, [path])
  return url
}
