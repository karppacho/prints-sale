import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import EditionCard from '../components/EditionCard'
import {
  fetchEditionStats,
  fetchEditionsWithArtists,
  type EditionStats,
  type EditionWithArtist,
} from '../lib/queries'

/** Тиражи одного художника (ТЗ §5.2) */
export default function EditionsPage() {
  const { artistId } = useParams()
  const [editions, setEditions] = useState<EditionWithArtist[] | null>(null)
  const [stats, setStats] = useState<Map<string, EditionStats>>(new Map())
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([fetchEditionsWithArtists(), fetchEditionStats()])
      .then(([e, s]) => {
        setEditions(e)
        setStats(new Map(s.map((x) => [x.edition_id, x])))
      })
      .catch((e) => setError(String(e.message ?? e)))
  }, [])

  const mine = useMemo(
    () => (editions ?? []).filter((e) => e.artist_id === artistId),
    [editions, artistId],
  )

  if (error) return <div className="text-red-600 text-sm py-4">{error}</div>
  if (!editions) return <div className="text-gray-400 text-center py-10">Загрузка…</div>

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Link to="/" className="text-2xl leading-none px-1">
          ‹
        </Link>
        <h1 className="font-bold text-lg">{mine[0]?.artists.name ?? 'Художник'}</h1>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {mine.map((e) => (
          <EditionCard key={e.id} edition={e} stats={stats.get(e.id)} />
        ))}
      </div>
      {mine.length === 0 && (
        <div className="text-gray-400 text-center py-10">У художника нет тиражей</div>
      )}
    </div>
  )
}
