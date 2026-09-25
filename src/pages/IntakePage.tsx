import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { DEFAULT_PRICE_FRAMED, DEFAULT_PRICE_UNFRAMED } from '../lib/config'
import { compressImage } from '../lib/imageCompress'
import { parseNumbers } from '../lib/numbers'
import { fetchArtists, fetchBranches } from '../lib/queries'
import type { Artist, Branch } from '../types'

const NEW_ARTIST = '__new__'

/** Приход тиража (ТЗ §5.6) — админ и владелец */
export default function IntakePage() {
  const { branchId: myBranchId } = useAuth()
  const navigate = useNavigate()

  const [artists, setArtists] = useState<Artist[]>([])
  const [branches, setBranches] = useState<Branch[]>([])

  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [artistId, setArtistId] = useState('')
  const [newArtistName, setNewArtistName] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [editionSize, setEditionSize] = useState('')
  const [royalty, setRoyalty] = useState('')
  const [signedStr, setSignedStr] = useState('')
  const [branchId, setBranchId] = useState('')
  const [priceUnframed, setPriceUnframed] = useState(DEFAULT_PRICE_UNFRAMED)
  const [priceFramed, setPriceFramed] = useState(DEFAULT_PRICE_FRAMED)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchArtists().then(setArtists)
    fetchBranches().then(setBranches)
  }, [])

  useEffect(() => {
    // Филиал поступления предзаполнен филиалом сотрудника (§5.6 п.7)
    if (myBranchId) setBranchId(myBranchId)
  }, [myBranchId])

  function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setPhotoFile(f)
    if (photoPreview) URL.revokeObjectURL(photoPreview)
    setPhotoPreview(f ? URL.createObjectURL(f) : null)
  }

  // Предпросмотр разбора номеров (печать ≡ подпись — один список)
  const numbersPreview = useMemo(() => {
    const size = parseInt(editionSize, 10)
    if (!size || size <= 0) return null
    try {
      const signed = parseNumbers(signedStr, size)
      return { signed, error: null as string | null }
    } catch (e) {
      return { signed: [], error: (e as Error).message }
    }
  }, [editionSize, signedStr])

  const hasPhysical = (numbersPreview?.signed.length ?? 0) > 0

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)

    const size = parseInt(editionSize, 10)
    const royaltyNum = parseFloat(royalty.replace(',', '.'))
    const unframedNum = parseFloat(priceUnframed.replace(',', '.'))
    const framedNum = parseFloat(priceFramed.replace(',', '.'))
    if (!size || size <= 0) return setError('Укажите размер тиража')
    if (isNaN(royaltyNum) || royaltyNum < 0)
      return setError('Укажите роялти художника (₽ за экземпляр)')
    if (isNaN(unframedNum) || unframedNum < 0 || isNaN(framedNum) || framedNum < 0)
      return setError('Укажите цены без рамки и с рамкой')
    if (!artistId) return setError('Выберите художника')
    if (artistId === NEW_ARTIST && !newArtistName.trim())
      return setError('Введите имя нового художника')
    if (numbersPreview?.error) return setError(numbersPreview.error)
    if (hasPhysical && !branchId) return setError('Укажите филиал поступления')

    setBusy(true)
    try {
      // 1. Новый художник при необходимости
      let finalArtistId = artistId
      if (artistId === NEW_ARTIST) {
        const { data, error: err } = await supabase
          .from('artists')
          .insert({ name: newArtistName.trim() })
          .select('id')
          .single()
        if (err) throw err
        finalArtistId = data.id
      }

      // 2. Фото: сжатие до ~1600px и загрузка в приватный bucket
      let imagePath: string | null = null
      if (photoFile) {
        const blob = await compressImage(photoFile)
        imagePath = `editions/${crypto.randomUUID()}.jpg`
        const { error: upErr } = await supabase.storage
          .from('art-images')
          .upload(imagePath, blob, { contentType: 'image/jpeg' })
        if (upErr) throw upErr
      }

      // 3. RPC add_edition — тираж + все номера со статусами
      const altTitles = tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
      const { data: editionId, error: rpcErr } = await supabase.rpc('add_edition', {
        p_artist_id: finalArtistId,
        p_title: title || null,
        p_alt_titles: altTitles,
        p_image_path: imagePath,
        p_edition_size: size,
        p_royalty_amount: royaltyNum,
        p_printed: [],
        p_signed: numbersPreview?.signed ?? [],
        p_price_unframed: unframedNum,
        p_price_framed: framedNum,
        p_branch_id: branchId || null,
      })
      if (rpcErr) throw rpcErr

      navigate(`/editions/${editionId}`)
    } catch (e) {
      setError((e as Error).message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  const inputCls =
    'mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'

  return (
    <form onSubmit={onSubmit} className="pb-8 space-y-4">
      <h1 className="font-bold text-lg">Приход тиража</h1>

      <div>
        <label className="block text-sm font-medium text-gray-700">
          Фото картины
          <input
            type="file"
            accept="image/*"
            onChange={onPhoto}
            className="mt-1 w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-gray-900 file:text-white file:px-4 file:py-2"
          />
        </label>
        {photoPreview && (
          <img
            src={photoPreview}
            alt="Предпросмотр"
            className="mt-2 w-full aspect-[4/3] object-cover rounded-xl"
          />
        )}
      </div>

      <label className="block text-sm font-medium text-gray-700">
        Художник
        <select
          value={artistId}
          onChange={(e) => setArtistId(e.target.value)}
          className={inputCls}
        >
          <option value="">— выберите —</option>
          {artists.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
          <option value={NEW_ARTIST}>+ Новый художник</option>
        </select>
      </label>

      {artistId === NEW_ARTIST && (
        <label className="block text-sm font-medium text-gray-700">
          Имя нового художника
          <input
            value={newArtistName}
            onChange={(e) => setNewArtistName(e.target.value)}
            className={inputCls}
          />
        </label>
      )}

      <label className="block text-sm font-medium text-gray-700">
        Название
        <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
      </label>

      <label className="block text-sm font-medium text-gray-700">
        Теги / альтернативные названия (через запятую)
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="котик, кот на крыше"
          className={inputCls}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-gray-700">
          Размер тиража
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={editionSize}
            onChange={(e) => setEditionSize(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Роялти, ₽/экз. *
          <input
            type="number"
            inputMode="numeric"
            min={0}
            value={royalty}
            onChange={(e) => setRoyalty(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      <label className="block text-sm font-medium text-gray-700">
        Номера отпечатанных/подписанных (например: 1-5, 8)
        <input
          value={signedStr}
          onChange={(e) => setSignedStr(e.target.value)}
          placeholder="пусто — ничего не отпечатано"
          className={inputCls}
        />
      </label>

      {numbersPreview?.error && (
        <div className="text-sm text-red-600">{numbersPreview.error}</div>
      )}
      {numbersPreview && !numbersPreview.error && hasPhysical && (
        <div className="text-xs text-gray-500">
          Отпечатано/подписано: {numbersPreview.signed.join(', ')}
        </div>
      )}

      <label className="block text-sm font-medium text-gray-700">
        Филиал поступления {hasPhysical && '*'}
        <select
          value={branchId}
          onChange={(e) => setBranchId(e.target.value)}
          className={inputCls}
        >
          <option value="">— выберите —</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-gray-700">
          Цена без рамки, ₽
          <input
            type="number"
            inputMode="numeric"
            value={priceUnframed}
            onChange={(e) => setPriceUnframed(e.target.value)}
            className={inputCls}
          />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Цена с рамкой, ₽
          <input
            type="number"
            inputMode="numeric"
            value={priceFramed}
            onChange={(e) => setPriceFramed(e.target.value)}
            className={inputCls}
          />
        </label>
      </div>

      {error && <div className="text-sm text-red-600">{error}</div>}

      <button
        type="submit"
        disabled={busy}
        className="w-full bg-gray-900 text-white rounded-xl py-3.5 font-semibold disabled:opacity-50"
      >
        {busy ? 'Сохранение…' : 'Оприходовать тираж'}
      </button>
    </form>
  )
}
