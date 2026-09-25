import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import EditionCard from '../components/EditionCard'
import {
  editionMatches,
  fetchArtists,
  fetchEditionStats,
  fetchEditionsWithArtists,
  type EditionStats,
  type EditionWithArtist,
} from '../lib/queries'
import type { Artist } from '../types'

/**
 * Каталог в режиме «магазин» (ТЗ §5.2): список художников с количеством
 * подписанных работ в наличии; поиск по названию и тегам показывает
 * плоский список тиражей.
 */
export default function ArtistsPage() {
  const [artists, setArtists] = useState<Artist[] | null>(null)
  const [editions, setEditions] = useState<EditionWithArtist[]>([])
  const [stats, setStats] = useState<Map<string, EditionStats>>(new Map())
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchArtists(), fetchEditionsWithArtists(), fetchEditionStats()])
      .then(([a, e, s]) => {
        setArtists(a)
        setEditions(e)
        setStats(new Map(s.map((x) => [x.edition_id, x])))
      })
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  const signedByArtist = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of editions) {
      const s = stats.get(e.id)
      if (s) m.set(e.artist_id, (m.get(e.artist_id) ?? 0) + s.signed_cnt)
    }
    return m
  }, [editions, stats])

  const found = useMemo(
    () => (query.trim() ? editions.filter((e) => editionMatches(e, query)) : []),
    [editions, query],
  )

  if (error) return <div className="text-red-600 text-sm py-4">{error}</div>
  if (!artists) return <div className="text-gray-400 text-center py-10">Загрузка…</div>

  return (
    <div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Поиск картины по названию или тегу…"
        className="w-full rounded-xl border border-gray-300 px-3 py-2.5 mb-3 text-base bg-white"
      />

      {query.trim() ? (
        <div className="grid grid-cols-2 gap-3">
          {found.map((e) => (
            <EditionCard key={e.id} edition={e} stats={stats.get(e.id)} showArtist />
          ))}
          {found.length === 0 && (
            <div className="col-span-2 text-gray-400 text-center py-8">
              Ничего не найдено
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {artists.map((a) => (
            <Link
              key={a.id}
              to={`/artists/${a.id}`}
              className="flex items-center justify-between bg-white rounded-xl p-4 shadow-sm active:scale-[0.99]"
            >
              <div className="font-medium">{a.name}</div>
              <div className="text-sm text-gray-500">
                в наличии{' '}
                <span className="font-semibold text-green-700">
                  {signedByArtist.get(a.id) ?? 0}
                </span>
              </div>
            </Link>
          ))}
          {artists.length === 0 && (
            <div className="text-gray-400 text-center py-8">
              Художников пока нет — добавьте через «Приход тиража»
            </div>
          )}
        </div>
      )}
    </div>
  )
}
