import { Link } from 'react-router-dom'
import ArtImage from './ArtImage'
import type { EditionStats, EditionWithArtist } from '../lib/queries'

export default function EditionCard({
  edition,
  stats,
  showArtist = false,
}: {
  edition: EditionWithArtist
  stats?: EditionStats
  showArtist?: boolean
}) {
  return (
    <Link
      to={`/editions/${edition.id}`}
      className="block bg-white rounded-xl shadow-sm overflow-hidden active:scale-[0.99]"
    >
      <ArtImage
        path={edition.image_path}
        alt={edition.title ?? 'Картина'}
        className="w-full aspect-[4/3]"
      />
      <div className="p-3">
        <div className="font-semibold truncate">{edition.title || 'Без названия'}</div>
        {showArtist && (
          <div className="text-sm text-gray-500 truncate">{edition.artists.name}</div>
        )}
        <div className="text-xs text-gray-600 mt-1.5 leading-snug">
          Тираж {edition.edition_size}
          {stats && (
            <>
              {' · '}
              <span className="text-green-700 font-medium">
                подписано {stats.signed_cnt}
              </span>
              {' · '}продано {stats.sold_cnt}
              {' · '}допечатать {stats.not_printed_cnt}
            </>
          )}
        </div>
      </div>
    </Link>
  )
}
