import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ArtImage from '../components/ArtImage'
import QuickSaleSheet from '../components/QuickSaleSheet'
import { useAuth } from '../auth/AuthContext'
import { useShift } from '../auth/ShiftContext'
import { useCart } from '../cart/CartContext'
import { supabase } from '../lib/supabase'
import { branchAbbr } from '../lib/format'
import {
  fetchBranches,
  fetchCopies,
  fetchEdition,
  type EditionWithArtist,
} from '../lib/queries'
import type { Branch, EditionCopy } from '../types'

type UiMode = 'sale' | 'status' | 'transfer'

/**
 * Экземпляры тиража (ТЗ §5.3): сетка номеров 1…N со статусами и метками
 * филиалов; продажа тапом; для админа/владельца — «Печать/подпись» и
 * «Отправить в филиал».
 */
export default function CopiesPage() {
  const { editionId } = useParams()
  const navigate = useNavigate()
  const { role, branchId: myBranchId } = useAuth()
  const { mode: shiftMode } = useShift()
  const cart = useCart()

  const [edition, setEdition] = useState<EditionWithArtist | null>(null)
  const [copies, setCopies] = useState<EditionCopy[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)

  const [uiMode, setUiMode] = useState<UiMode>('sale')
  const [selected, setSelected] = useState<Set<string>>(new Set()) // copy ids
  const [targetBranch, setTargetBranch] = useState<string>('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [quickSaleCopy, setQuickSaleCopy] = useState<EditionCopy | null>(null)

  const isStaff = role === 'admin' || role === 'owner'
  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches])

  const load = useCallback(async () => {
    if (!editionId) return
    try {
      const [e, c, b] = await Promise.all([
        fetchEdition(editionId),
        fetchCopies(editionId),
        fetchBranches(),
      ])
      setEdition(e)
      setCopies(c)
      setBranches(b)
      setLoaded(true)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }, [editionId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 1800)
    return () => clearTimeout(t)
  }, [toast])

  // Счётчик наличия в разрезе филиалов: «подписано 5 (СПб 3 · МСК 2)»
  const counters = useMemo(() => {
    const signed = copies.filter((c) => c.status === 'signed')
    const byBranch = new Map<string, number>()
    for (const c of signed) {
      if (c.branch_id) byBranch.set(c.branch_id, (byBranch.get(c.branch_id) ?? 0) + 1)
    }
    const parts = [...byBranch.entries()]
      .map(([id, n]) => `${branchAbbr(branchById.get(id)?.name ?? '?')} ${n}`)
      .join(' · ')
    return {
      signed: signed.length,
      signedParts: parts,
      sold: copies.filter((c) => c.status === 'sold').length,
      notPrinted: copies.filter((c) => c.status === 'not_printed').length,
    }
  }, [copies, branchById])

  /** Можно ли продать номер текущему сотруднику (UI-подсказка; истина — в БД) */
  function canSell(c: EditionCopy): boolean {
    if (c.status === 'not_printed') return true
    if (c.status !== 'signed') return false
    // Владелец без филиала выбирает филиал при оформлении — не ограничиваем
    if (!myBranchId) return true
    return c.branch_id === myBranchId
  }

  function tapCopy(c: EditionCopy) {
    if (uiMode === 'sale') {
      if (!edition) return
      if (cart.has(c.id)) {
        cart.remove(c.id)
        setToast(`№ ${c.copy_number} убран из корзины`)
        return
      }
      if (!canSell(c)) return
      // Режим «ярмарка»: тап открывает шторку быстрой продажи (ТЗ §5.4а)
      if (shiftMode === 'fair') {
        setQuickSaleCopy(c)
        return
      }
      cart.add({
        copyId: c.id,
        editionId: edition.id,
        copyNumber: c.copy_number,
        editionSize: edition.edition_size,
        title: edition.title,
        artistName: edition.artists.name,
        imagePath: edition.image_path,
        status: c.status,
        priceUnframed: edition.price_unframed,
        priceFramed: edition.price_framed,
      })
      setToast(`№ ${c.copy_number} в корзине`)
      return
    }

    // Режимы выделения (печать/подпись, перемещение)
    const eligible =
      uiMode === 'status'
        ? ['not_printed', 'signed'].includes(c.status)
        : c.status === 'signed' &&
          (!myBranchId || role !== 'seller' || c.branch_id === myBranchId)
    if (!eligible) return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(c.id)) next.delete(c.id)
      else next.add(c.id)
      return next
    })
  }

  function enterMode(mode: UiMode) {
    setUiMode(mode)
    setSelected(new Set())
    setComment('')
    setTargetBranch(mode === 'status' ? (myBranchId ?? branches[0]?.id ?? '') : '')
  }

  async function applyStatus(status: 'not_printed' | 'signed') {
    if (!editionId || selected.size === 0) return
    const numbers = copies.filter((c) => selected.has(c.id)).map((c) => c.copy_number)
    setBusy(true)
    const { error: err } = await supabase.rpc('update_copies_status', {
      p_edition_id: editionId,
      p_numbers: numbers,
      p_status: status,
      p_branch_id: status === 'not_printed' ? null : targetBranch || null,
    })
    setBusy(false)
    if (err) {
      setToast(err.message)
      return
    }
    enterMode('sale')
    await load()
    setToast('Статусы обновлены')
  }

  async function applyTransfer() {
    if (selected.size === 0 || !targetBranch) return
    setBusy(true)
    const { error: err } = await supabase.rpc('send_transfer', {
      p_copy_ids: [...selected],
      p_to_branch_id: targetBranch,
      p_comment: comment || null,
    })
    setBusy(false)
    if (err) {
      setToast(err.message)
      return
    }
    enterMode('sale')
    await load()
    setToast('Перемещение оформлено')
  }

  if (error) return <div className="text-red-600 text-sm py-4">{error}</div>
  if (!loaded || !edition)
    return <div className="text-gray-400 text-center py-10">Загрузка…</div>

  const sourceBranchIds = new Set(
    copies.filter((c) => selected.has(c.id)).map((c) => c.branch_id),
  )

  return (
    <div className="pb-40">
      <div className="flex items-center gap-2 mb-3">
        <Link to={`/artists/${edition.artist_id}`} className="text-2xl leading-none px-1">
          ‹
        </Link>
        <div className="min-w-0">
          <h1 className="font-bold text-lg leading-tight truncate">
            {edition.title || 'Без названия'}
          </h1>
          <div className="text-sm text-gray-500 truncate">{edition.artists.name}</div>
        </div>
      </div>

      <ArtImage
        path={edition.image_path}
        alt={edition.title ?? 'Картина'}
        className="w-full aspect-[4/3] rounded-xl"
      />

      <div className="mt-3 text-sm text-gray-700">
        Тираж {edition.edition_size}
        {' · '}
        <span className="text-green-700 font-medium">
          подписано {counters.signed}
          {counters.signedParts ? ` (${counters.signedParts})` : ''}
        </span>
        {' · '}продано {counters.sold}
        {' · '}допечатать {counters.notPrinted}
      </div>

      {isStaff && uiMode === 'sale' && (
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => enterMode('status')}
            className="flex-1 text-sm py-2 rounded-lg bg-white border border-gray-300 font-medium"
          >
            🖨️ Печать/подпись
          </button>
          <button
            onClick={() => enterMode('transfer')}
            className="flex-1 text-sm py-2 rounded-lg bg-white border border-gray-300 font-medium"
          >
            🚚 Отправить в филиал
          </button>
        </div>
      )}
      {role === 'seller' && uiMode === 'sale' && (
        <div className="mt-3">
          <button
            onClick={() => enterMode('transfer')}
            className="w-full text-sm py-2 rounded-lg bg-white border border-gray-300 font-medium"
          >
            🚚 Отправить в филиал (из своего)
          </button>
        </div>
      )}
      {uiMode !== 'sale' && (
        <div className="mt-3 flex items-center justify-between bg-amber-50 border border-amber-300 rounded-lg px-3 py-2 text-sm">
          <span>
            {uiMode === 'status' ? 'Выберите номера для печати/подписи' : 'Выберите подписанные номера'}
            {selected.size > 0 && ` — ${selected.size}`}
          </span>
          <button onClick={() => enterMode('sale')} className="font-semibold">
            Отмена
          </button>
        </div>
      )}

      <div className="grid grid-cols-10 gap-1 sm:gap-1.5 mt-3">
        {copies.map((c) => {
          const foreign =
            c.branch_id && myBranchId && c.branch_id !== myBranchId
          const inCart = cart.has(c.id)
          const isSelected = selected.has(c.id)
          const abbr = c.branch_id
            ? branchAbbr(branchById.get(c.branch_id)?.name ?? '?')
            : null

          let cls = 'bg-white border-gray-300 text-gray-400' // fallback
          if (c.status === 'signed')
            cls = foreign
              ? 'bg-green-50 border-green-500 text-green-800'
              : 'bg-green-500 border-green-600 text-white'
          else if (c.status === 'not_printed')
            cls = 'bg-transparent border-dashed border-gray-400 text-gray-500'
          else if (c.status === 'sold') cls = 'bg-gray-300 border-gray-300 text-gray-500'
          else if (c.status === 'reserved') cls = 'bg-blue-500 border-blue-600 text-white'

          return (
            <button
              key={c.id}
              onClick={() => tapCopy(c)}
              className={`relative aspect-square rounded-md border-2 flex flex-col items-center justify-center text-xs sm:text-sm font-semibold active:scale-95 ${cls} ${
                inCart && uiMode === 'sale' ? 'ring-2 ring-offset-1 ring-gray-900' : ''
              } ${isSelected ? 'ring-2 ring-offset-1 ring-amber-500' : ''}`}
              title={c.location ?? undefined}
            >
              {c.copy_number}
              {abbr && c.status !== 'sold' && (foreign || !myBranchId) && (
                <span className="text-[9px] font-normal leading-none mt-0.5">{abbr}</span>
              )}
              {inCart && uiMode === 'sale' && (
                <span className="absolute -top-1.5 -right-1.5 bg-gray-900 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center">
                  ✓
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Легенда (ТЗ §5.3) */}
      <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs text-gray-600">
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-green-500 border-2 border-green-600 shrink-0" />
          подписан, в наличии
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-green-50 border-2 border-green-500 shrink-0" />
          подписан в другом филиале
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded border-2 border-dashed border-gray-400 shrink-0" />
          не отпечатан (под печать)
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-gray-300 shrink-0" />
          продан
        </div>
        <div className="flex items-center gap-2">
          <span className="w-4 h-4 rounded bg-blue-500 border-2 border-blue-600 shrink-0" />
          бронь (сайт, позже)
        </div>
      </div>

      {/* Панель действий: печать/подпись */}
      {uiMode === 'status' && selected.size > 0 && (
        <div className="fixed bottom-14 inset-x-0 z-20 bg-white border-t p-3 space-y-2 max-w-3xl mx-auto">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500 shrink-0">Филиал:</span>
            <select
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 bg-white"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              disabled={busy}
              onClick={() => void applyStatus('not_printed')}
              className="py-2.5 rounded-lg border-2 border-dashed border-gray-400 text-sm font-medium disabled:opacity-50"
            >
              Не отпечатан
            </button>
            <button
              disabled={busy}
              onClick={() => void applyStatus('signed')}
              className="py-2.5 rounded-lg bg-green-500 text-white text-sm font-medium disabled:opacity-50"
            >
              Отпечатан/подписан
            </button>
          </div>
        </div>
      )}

      {/* Панель действий: перемещение */}
      {uiMode === 'transfer' && selected.size > 0 && (
        <div className="fixed bottom-14 inset-x-0 z-20 bg-white border-t p-3 space-y-2 max-w-3xl mx-auto">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500 shrink-0">Куда:</span>
            <select
              value={targetBranch}
              onChange={(e) => setTargetBranch(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5 bg-white"
            >
              <option value="">— выберите филиал —</option>
              {branches
                .filter((b) => !sourceBranchIds.has(b.id))
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
          </div>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Комментарий (необязательно)"
            className="w-full rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            disabled={busy || !targetBranch}
            onClick={() => void applyTransfer()}
            className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-sm font-semibold disabled:opacity-50"
          >
            {busy ? 'Оформление…' : `Переместить ${selected.size} шт.`}
          </button>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-20 inset-x-0 z-40 flex justify-center px-4 pointer-events-none">
          <div className="bg-gray-900 text-white text-sm px-4 py-2 rounded-full shadow-lg">
            {toast}
          </div>
        </div>
      )}

      {quickSaleCopy && edition && (
        <QuickSaleSheet
          copy={quickSaleCopy}
          edition={edition}
          onClose={() => setQuickSaleCopy(null)}
          // Ярмарка: после продажи и после «в корзину» — сразу в каталог
          onSold={() => navigate('/')}
          onAddedToCart={() => navigate('/')}
        />
      )}
    </div>
  )
}
