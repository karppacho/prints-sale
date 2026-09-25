import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useShift } from '../auth/ShiftContext'
import { useCart } from '../cart/CartContext'
import { newSaleId, submitSale, loadPending } from '../cart/submitSale'
import ArtImage from './ArtImage'
import { fmtRub } from '../lib/format'
import { fetchBranches, fetchPaymentMethods } from '../lib/queries'
import type { EditionWithArtist } from '../lib/queries'
import type { Branch, EditionCopy, PaymentMethod } from '../types'

/**
 * Быстрая продажа в режиме «ярмарка» (ТЗ §5.4а): тап по номеру → шторка →
 * способ оплаты → «Продать». Норматив: 3 нажатия, ≤ 12 секунд.
 * Технически — тот же RPC sell с корзиной из одной позиции.
 */
export default function QuickSaleSheet({
  copy,
  edition,
  onClose,
  onSold,
  onAddedToCart,
}: {
  copy: EditionCopy
  edition: EditionWithArtist
  onClose: () => void
  onSold: () => void
  onAddedToCart?: () => void
}) {
  const { role, branchId: myBranchId } = useAuth()
  const { fairName } = useShift()
  const cart = useCart()

  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [method, setMethod] = useState('cash')
  const [framed, setFramed] = useState(false)
  const [more, setMore] = useState(false)
  const [discount, setDiscount] = useState(0)
  const [comment, setComment] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [saleBranch, setSaleBranch] = useState('')
  const [saleId] = useState(newSaleId) // фиксируем до отправки — повтор не создаст дубль
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pendingSaved, setPendingSaved] = useState(false)

  const needBranchChoice = role === 'owner' && !myBranchId

  useEffect(() => {
    fetchPaymentMethods().then(setMethods)
    if (needBranchChoice) fetchBranches().then(setBranches)
  }, [needBranchChoice])

  // Наличные, карта и перевод — первыми и крупно; остальные за «ещё»
  const PRIMARY_CODES = ['cash', 'card', 'transfer']
  const primary = methods.filter((m) => PRIMARY_CODES.includes(m.code))
  const secondary = methods.filter((m) => !PRIMARY_CODES.includes(m.code))
  const methodEmoji: Record<string, string> = { cash: '💵', card: '💳', transfer: '📲' }
  const isDeferred = methods.find((m) => m.code === method)?.is_deferred ?? false

  const price = Math.max(
    0,
    (framed ? edition.price_framed : edition.price_unframed) - (discount || 0),
  )

  async function sell() {
    if (busy || isDeferred) return // постоплата на ярмарке — через обычный чек
    if (needBranchChoice && !saleBranch) {
      setError('Выберите филиал продажи')
      return
    }
    setBusy(true)
    setError(null)
    const res = await submitSale({
      saleId,
      items: [{ copy_id: copy.id, framed, discount: discount || 0 }],
      paymentMethod: method,
      buyerType: 'fair',
      fairName,
      debtorId: null,
      comment: comment.trim() || null,
      branchId: needBranchChoice ? saleBranch : null,
      totalHint: price,
    })
    setBusy(false)
    if (res.ok) {
      setDone(true)
      setTimeout(() => {
        onSold()
        onClose()
      }, 900)
    } else {
      setError(res.error)
      if (res.retriable && loadPending()) setPendingSaved(true)
    }
  }

  function addToCart() {
    cart.add({
      copyId: copy.id,
      editionId: edition.id,
      copyNumber: copy.copy_number,
      editionSize: edition.edition_size,
      title: edition.title,
      artistName: edition.artists.name,
      imagePath: edition.image_path,
      status: copy.status,
      priceUnframed: edition.price_unframed,
      priceFramed: edition.price_framed,
    })
    onAddedToCart?.()
  }

  return (
    <div className="fixed inset-0 z-50" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl p-4 pb-6 max-w-3xl mx-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-gray-300 rounded mx-auto mb-3" />

        {done ? (
          <div className="py-10 text-center">
            <div className="text-5xl">✅</div>
            <div className="font-bold text-lg mt-2">Продано за {fmtRub(price)}</div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <ArtImage
                path={edition.image_path}
                alt={edition.title ?? ''}
                className="w-14 h-14 rounded-lg shrink-0"
              />
              <div className="min-w-0">
                <div className="font-semibold truncate">
                  {edition.title || 'Без названия'} · № {copy.copy_number} из{' '}
                  {edition.edition_size}
                </div>
                <div className="text-sm text-gray-500 truncate">{edition.artists.name}</div>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <div className="flex rounded-lg overflow-hidden border border-gray-300">
                <button
                  onClick={() => setFramed(false)}
                  className={`px-4 py-2 text-sm ${!framed ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
                >
                  Без рамки
                </button>
                <button
                  onClick={() => setFramed(true)}
                  className={`px-4 py-2 text-sm ${framed ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
                >
                  С рамкой
                </button>
              </div>
              <div className="text-2xl font-bold">{fmtRub(price)}</div>
            </div>

            <div className="grid grid-cols-3 gap-2 mt-4">
              {primary.map((m) => (
                <button
                  key={m.code}
                  onClick={() => setMethod(m.code)}
                  className={`py-3 rounded-xl text-sm font-semibold border-2 ${
                    method === m.code
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white border-gray-300 text-gray-700'
                  }`}
                >
                  {methodEmoji[m.code] ? `${methodEmoji[m.code]} ` : ''}
                  {m.label}
                </button>
              ))}
            </div>

            <button
              onClick={addToCart}
              className="mt-2 w-full py-3 rounded-xl border-2 border-gray-300 text-base font-semibold"
            >
              🛒 + в корзину
            </button>

            <button
              onClick={() => setMore((v) => !v)}
              className="mt-3 text-sm text-gray-500 underline"
            >
              {more ? 'скрыть' : 'ещё…'}
            </button>

            {more && (
              <div className="mt-2 space-y-3">
                <div className="grid grid-cols-3 gap-2">
                  {secondary
                    .filter((m) => !m.is_deferred)
                    .map((m) => (
                      <button
                        key={m.code}
                        onClick={() => setMethod(m.code)}
                        className={`py-2 rounded-lg text-sm border ${
                          method === m.code
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white border-gray-300 text-gray-600'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-500">Скидка:</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={discount || ''}
                    onChange={(e) => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))}
                    placeholder="0"
                    className="w-24 rounded-lg border border-gray-300 px-2 py-1.5 text-right"
                  />
                  <span className="text-gray-400">₽</span>
                  <input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Комментарий"
                    className="flex-1 rounded-lg border border-gray-300 px-2 py-1.5"
                  />
                </div>
              </div>
            )}

            {needBranchChoice && (
              <select
                value={saleBranch}
                onChange={(e) => setSaleBranch(e.target.value)}
                className="mt-3 w-full rounded-lg border border-gray-300 px-2 py-2 bg-white text-sm"
              >
                <option value="">Филиал продажи —</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            )}

            {error && (
              <div className="mt-3 text-sm text-red-600">
                {error}
                {pendingSaved && ' — откройте корзину, чтобы повторить'}
              </div>
            )}

            <button
              onClick={() => void sell()}
              disabled={busy}
              className="mt-4 w-full bg-green-600 text-white rounded-xl py-4 text-lg font-bold disabled:opacity-50"
            >
              {busy ? 'Оформление…' : `Продать за ${fmtRub(price)}`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
