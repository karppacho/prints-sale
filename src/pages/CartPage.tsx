import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useShift } from '../auth/ShiftContext'
import { itemPrice, useCart } from '../cart/CartContext'
import {
  clearPending,
  loadPending,
  newSaleId,
  submitSale,
  type SalePayload,
} from '../cart/submitSale'
import ArtImage from '../components/ArtImage'
import { fmtRub } from '../lib/format'
import {
  createDebtor,
  fetchBranches,
  fetchBuyerTypes,
  fetchDebtors,
  fetchPaymentMethods,
} from '../lib/queries'
import type { Branch, BuyerType, Debtor, PaymentMethod } from '../types'

type Step = 'cart' | 'success'

const NEW_DEBTOR = '__new__'

/** Корзина и оформление чека (ТЗ §5.4) */
export default function CartPage() {
  const { role, branchId: myBranchId } = useAuth()
  const { mode: shiftMode, fairName } = useShift()
  const cart = useCart()
  const navigate = useNavigate()

  const [buyerTypes, setBuyerTypes] = useState<BuyerType[]>([])
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [branches, setBranches] = useState<Branch[]>([])

  const [buyerType, setBuyerType] = useState('')
  const [method, setMethod] = useState('')
  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [debtorId, setDebtorId] = useState('')
  const [newDebtorName, setNewDebtorName] = useState('')
  const [newDebtorContact, setNewDebtorContact] = useState('')
  const [comment, setComment] = useState('')
  const [saleBranch, setSaleBranch] = useState('')

  const [saleId, setSaleId] = useState(newSaleId) // id чека — до отправки (идемпотентность)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<Step>('cart')
  const [doneTotal, setDoneTotal] = useState(0)
  const [pending, setPending] = useState(loadPending)

  const needBranchChoice = role === 'owner' && !myBranchId
  const isFair = shiftMode === 'fair'

  useEffect(() => {
    fetchBuyerTypes().then((bt) => {
      setBuyerTypes(bt)
      setBuyerType(isFair ? 'fair' : (bt[0]?.code ?? ''))
    })
    fetchPaymentMethods().then((pm) => {
      setMethods(pm)
      setMethod(pm[0]?.code ?? '')
    })
    if (needBranchChoice) fetchBranches().then(setBranches)
  }, [isFair, needBranchChoice])

  const selectedMethod = methods.find((m) => m.code === method)
  const isDeferred = selectedMethod?.is_deferred ?? false

  // Справочник должников подгружается при выборе постоплаты
  useEffect(() => {
    if (isDeferred && debtors.length === 0) {
      fetchDebtors().then(setDebtors).catch(() => {})
    }
  }, [isDeferred, debtors.length])

  const canSubmit =
    cart.items.length > 0 &&
    !!buyerType &&
    !!method &&
    (!isDeferred ||
      (debtorId === NEW_DEBTOR ? !!newDebtorName.trim() : !!debtorId)) &&
    (!needBranchChoice || !!saleBranch)

  const basePayload = useMemo<Omit<SalePayload, 'debtorId'>>(
    () => ({
      saleId,
      items: cart.items.map((i) => ({
        copy_id: i.copyId,
        framed: i.framed,
        discount: i.discount || 0,
      })),
      paymentMethod: method,
      buyerType,
      fairName: isFair ? fairName : null,
      comment: comment.trim() || null,
      branchId: needBranchChoice ? saleBranch : null,
      totalHint: cart.total,
    }),
    [saleId, cart.items, cart.total, method, buyerType, isFair, fairName, comment, needBranchChoice, saleBranch],
  )

  async function checkout() {
    if (!canSubmit || busy) return
    setBusy(true)
    setError(null)
    try {
      // Новый должник заводится в справочник перед отправкой чека;
      // при повторе после сбоя связи используется уже созданный id
      let finalDebtorId: string | null = null
      if (isDeferred) {
        if (debtorId === NEW_DEBTOR) {
          const d = await createDebtor(newDebtorName, newDebtorContact || null)
          setDebtors((prev) => [...prev, d].sort((a, b) => a.name.localeCompare(b.name, 'ru')))
          setDebtorId(d.id)
          finalDebtorId = d.id
        } else {
          finalDebtorId = debtorId
        }
      }
      const res = await submitSale({ ...basePayload, debtorId: finalDebtorId })
      if (res.ok) {
        setDoneTotal(cart.total)
        cart.clear()
        setPending(null)
        setStep('success')
      } else {
        setError(res.error)
        if (res.retriable) setPending(loadPending())
      }
    } catch (e) {
      setError((e as Error).message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function retryPending() {
    if (!pending || busy) return
    setBusy(true)
    setError(null)
    const res = await submitSale(pending)
    setBusy(false)
    if (res.ok) {
      setDoneTotal(pending.totalHint)
      setPending(null)
      setStep('success')
    } else {
      setError(res.error)
      if (!res.retriable) {
        // Чек отклонён базой (не сбой связи) — повторять бессмысленно
        clearPending()
        setPending(null)
      }
    }
  }

  function dropPending() {
    clearPending()
    setPending(null)
  }

  if (step === 'success') {
    return (
      <div className="py-16 text-center">
        <div className="text-6xl">✅</div>
        <div className="text-xl font-bold mt-4">Чек оформлен</div>
        <div className="text-gray-500 mt-1">{fmtRub(doneTotal)}</div>
        <button
          onClick={() => {
            setSaleId(newSaleId())
            setStep('cart')
            navigate('/')
          }}
          className="mt-8 bg-gray-900 text-white rounded-xl px-8 py-3 font-semibold"
        >
          К каталогу
        </button>
      </div>
    )
  }

  return (
    <div className="pb-8">
      <h1 className="font-bold text-lg mb-3">Корзина</h1>

      {/* Неотправленный чек после сбоя связи (ТЗ §5.4а) */}
      {pending && (
        <div className="bg-amber-50 border border-amber-400 rounded-xl p-3 mb-3 text-sm">
          <div className="font-semibold">
            Есть неотправленный чек на {fmtRub(pending.totalHint)}
          </div>
          <div className="text-gray-600 text-xs mt-0.5">
            Сохранён на устройстве. Повторная отправка не создаст дубль.
          </div>
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => void retryPending()}
              disabled={busy}
              className="flex-1 bg-gray-900 text-white rounded-lg py-2 font-medium disabled:opacity-50"
            >
              {busy ? 'Отправка…' : 'Повторить отправку'}
            </button>
            <button
              onClick={dropPending}
              className="px-3 rounded-lg border border-gray-300 text-gray-500"
            >
              Удалить
            </button>
          </div>
        </div>
      )}

      {cart.items.length === 0 ? (
        <div className="text-gray-400 text-center py-12">
          Корзина пуста.{' '}
          <Link to="/" className="text-gray-900 underline">
            К каталогу
          </Link>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {cart.items.map((i) => (
              <div key={i.copyId} className="bg-white rounded-xl p-3 shadow-sm">
                <div className="flex gap-3">
                  <ArtImage
                    path={i.imagePath}
                    alt={i.title ?? ''}
                    className="w-16 h-16 rounded-lg shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{i.title || 'Без названия'}</div>
                    <div className="text-sm text-gray-500 truncate">
                      {i.artistName} · № {i.copyNumber} из {i.editionSize}
                    </div>
                    {i.status !== 'signed' && (
                      <span className="inline-block mt-1 text-[11px] bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
                        🖨️ требует печати/подписи
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => cart.remove(i.copyId)}
                    className="text-gray-400 text-xl leading-none self-start"
                  >
                    ×
                  </button>
                </div>

                <div className="flex items-center gap-3 mt-3">
                  <div className="flex rounded-lg overflow-hidden border border-gray-300 text-sm">
                    <button
                      onClick={() => cart.setFramed(i.copyId, false)}
                      className={`px-3 py-1.5 ${!i.framed ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
                    >
                      Без рамки
                    </button>
                    <button
                      onClick={() => cart.setFramed(i.copyId, true)}
                      className={`px-3 py-1.5 ${i.framed ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
                    >
                      С рамкой
                    </button>
                  </div>
                  <div className="flex items-center gap-1 text-sm ml-auto">
                    <span className="text-gray-400">− скидка</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={i.discount || ''}
                      onChange={(e) =>
                        cart.setDiscount(i.copyId, Math.max(0, parseFloat(e.target.value) || 0))
                      }
                      placeholder="0"
                      className="w-20 rounded-lg border border-gray-300 px-2 py-1.5 text-right"
                    />
                    <span className="text-gray-400">₽</span>
                  </div>
                </div>
                <div className="text-right font-semibold mt-2">{fmtRub(itemPrice(i))}</div>
              </div>
            ))}
          </div>

          {/* Оформление */}
          <div className="bg-white rounded-xl p-4 shadow-sm mt-4 space-y-4">
            <label className="block text-sm font-medium text-gray-700">
              Тип покупателя
              <select
                value={buyerType}
                onChange={(e) => setBuyerType(e.target.value)}
                disabled={isFair}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white disabled:bg-gray-100"
              >
                {buyerTypes.map((bt) => (
                  <option key={bt.code} value={bt.code}>
                    {bt.label}
                    {isFair && bt.code === 'fair' && fairName ? ` · ${fairName}` : ''}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <div className="text-sm font-medium text-gray-700 mb-1.5">Способ оплаты</div>
              <div className="grid grid-cols-3 gap-2">
                {methods.map((m) => (
                  <button
                    key={m.code}
                    onClick={() => setMethod(m.code)}
                    className={`py-2 rounded-lg text-sm font-medium border ${
                      method === m.code
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white border-gray-300 text-gray-600'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {isDeferred && (
              <div className="space-y-3 border-l-4 border-amber-400 pl-3">
                <label className="block text-sm font-medium text-gray-700">
                  Должник *
                  <select
                    value={debtorId}
                    onChange={(e) => setDebtorId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white"
                  >
                    <option value="">— выберите —</option>
                    {debtors.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                    <option value={NEW_DEBTOR}>+ Новый должник</option>
                  </select>
                </label>
                {debtorId === NEW_DEBTOR && (
                  <>
                    <label className="block text-sm font-medium text-gray-700">
                      Название / имя *
                      <input
                        value={newDebtorName}
                        onChange={(e) => setNewDebtorName(e.target.value)}
                        placeholder="ООО «Ромашка»"
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5"
                      />
                    </label>
                    <label className="block text-sm font-medium text-gray-700">
                      Контакт
                      <input
                        value={newDebtorContact}
                        onChange={(e) => setNewDebtorContact(e.target.value)}
                        placeholder="телефон / telegram (необязательно)"
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5"
                      />
                    </label>
                  </>
                )}
                {debtorId && debtorId !== NEW_DEBTOR && (
                  <div className="text-xs text-gray-500">
                    Контакт: {debtors.find((d) => d.id === debtorId)?.contact || 'не указан'}
                  </div>
                )}
              </div>
            )}

            {needBranchChoice && (
              <label className="block text-sm font-medium text-gray-700">
                Филиал продажи *
                <select
                  value={saleBranch}
                  onChange={(e) => setSaleBranch(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 bg-white"
                >
                  <option value="">— выберите —</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="block text-sm font-medium text-gray-700">
              Комментарий
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5"
              />
            </label>
          </div>

          {error && <div className="text-sm text-red-600 mt-3">{error}</div>}

          <button
            onClick={() => void checkout()}
            disabled={!canSubmit || busy}
            className="mt-4 w-full bg-gray-900 text-white rounded-xl py-4 text-lg font-bold disabled:opacity-40"
          >
            {busy ? 'Оформление…' : `Оформить чек на ${fmtRub(cart.total)}`}
          </button>
        </>
      )}
    </div>
  )
}
