import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import CancelReasonDialog from '../components/CancelReasonDialog'
import { fmtDate, fmtRub, todayStr } from '../lib/format'
import type { SaleItemDetail } from '../export/xlsx'
import {
  fetchArtists,
  fetchBuyerTypes,
  fetchPaymentMethods,
  fetchUserDisplayNames,
} from '../lib/queries'
import type { Artist, BuyerType, PaymentMethod } from '../types'

type Tab = 'sales' | 'methods' | 'stock'
type DateBasis = 'sold' | 'paid'

interface SaleRow {
  id: string
  sold_at: string
  paid_at: string | null
  is_paid: boolean
  is_cancelled: boolean
  buyer_type: string
  fair_name: string | null
  payment_method: string
  paid_method: string | null
  debtor_name: string | null
  comment: string | null
  cancel_reason: string | null
  created_by: string
  total: number
  branches: { name: string } | null
  sale_items: {
    id: string
    framed: boolean
    base_price: number
    discount: number
    final_price: number
    royalty_amount: number
    edition_copies: {
      copy_number: number
      editions: { title: string | null; artist_id: string; artists: { name: string } | { name: string }[] }
    }
  }[]
}

interface StockRow {
  branch: string
  artist: string
  count: number
}

const an = (a: { name: string } | { name: string }[]) =>
  Array.isArray(a) ? (a[0]?.name ?? '') : a.name

function monthStart(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/** Отчёты владельца (ТЗ §5.8) */
export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('sales')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayStr())
  const [basis, setBasis] = useState<DateBasis>('sold')
  const [branchFilter, setBranchFilter] = useState('')
  const [artistFilter, setArtistFilter] = useState('')
  const [buyerFilter, setBuyerFilter] = useState('')
  const [methodFilter, setMethodFilter] = useState('')
  const [fairFilter, setFairFilter] = useState('')
  const [showCancelled, setShowCancelled] = useState(false)

  const [sales, setSales] = useState<SaleRow[] | null>(null)
  const [stock, setStock] = useState<StockRow[] | null>(null)
  const [artists, setArtists] = useState<Artist[]>([])
  const [buyerTypes, setBuyerTypes] = useState<BuyerType[]>([])
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [sellerNames, setSellerNames] = useState<Map<string, string>>(new Map())
  const [cancelling, setCancelling] = useState<SaleRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchArtists().then(setArtists)
    fetchBuyerTypes().then(setBuyerTypes)
    fetchPaymentMethods().then(setMethods)
    fetchUserDisplayNames().then(setSellerNames).catch(() => {})
  }, [])

  const methodLabel = useCallback(
    (code: string | null) => methods.find((m) => m.code === code)?.label ?? code ?? '',
    [methods],
  )
  const buyerLabel = useCallback(
    (code: string) => buyerTypes.find((b) => b.code === code)?.label ?? code,
    [buyerTypes],
  )

  const loadSales = useCallback(async () => {
    setSales(null)
    const dateField = basis === 'sold' ? 'sold_at' : 'paid_at'
    let q = supabase
      .from('sales')
      .select(
        `id, sold_at, paid_at, is_paid, is_cancelled, buyer_type, fair_name,
         payment_method, paid_method, debtor_name, comment, cancel_reason,
         created_by, total, branches(name),
         sale_items(id, framed, base_price, discount, final_price, royalty_amount,
           edition_copies(copy_number, editions(title, artist_id, artists(name))))`,
      )
      .gte(dateField, `${from}T00:00:00`)
      .lte(dateField, `${to}T23:59:59`)
      .order('sold_at', { ascending: false })
    if (basis === 'paid') q = q.eq('is_paid', true)
    const { data, error: err } = await q
    if (err) setError(err.message)
    else setSales((data ?? []) as unknown as SaleRow[])
  }, [from, to, basis])

  useEffect(() => {
    void loadSales()
  }, [loadSales])

  useEffect(() => {
    if (tab !== 'stock' || stock) return
    supabase
      .from('edition_copies')
      .select('branches(name), editions(artists(name))')
      .eq('status', 'signed')
      .then(({ data, error: err }) => {
        if (err) {
          setError(err.message)
          return
        }
        const m = new Map<string, number>()
        for (const row of (data ?? []) as unknown as {
          branches: { name: string } | null
          editions: { artists: { name: string } | { name: string }[] }
        }[]) {
          const key = `${row.branches?.name ?? '?'}||${an(row.editions.artists)}`
          m.set(key, (m.get(key) ?? 0) + 1)
        }
        setStock(
          [...m.entries()]
            .map(([key, count]) => {
              const [branch, artist] = key.split('||')
              return { branch, artist, count }
            })
            .sort((a, b) => a.branch.localeCompare(b.branch, 'ru') || a.artist.localeCompare(b.artist, 'ru')),
        )
      })
  }, [tab, stock])

  // Плоская детализация по позициям с учётом фильтров
  const details = useMemo<SaleItemDetail[]>(() => {
    const out: SaleItemDetail[] = []
    for (const s of sales ?? []) {
      if (!showCancelled && s.is_cancelled) continue
      if (branchFilter && s.branches?.name !== branchFilter) continue
      if (buyerFilter && s.buyer_type !== buyerFilter) continue
      if (fairFilter && !(s.fair_name ?? '').toLowerCase().includes(fairFilter.toLowerCase()))
        continue
      if (methodFilter) {
        const effective = basis === 'paid' ? s.paid_method : s.payment_method
        if (effective !== methodFilter) continue
      }
      for (const i of s.sale_items) {
        if (artistFilter && i.edition_copies.editions.artist_id !== artistFilter) continue
        out.push({
          saleId: s.id,
          itemId: i.id,
          artistId: i.edition_copies.editions.artist_id,
          soldAt: s.sold_at,
          paidAt: s.paid_at,
          isPaid: s.is_paid,
          isCancelled: s.is_cancelled,
          branch: s.branches?.name ?? '?',
          buyerType: buyerLabel(s.buyer_type),
          fairName: s.fair_name,
          paymentMethod: methodLabel(s.payment_method),
          paidMethod: s.paid_method ? methodLabel(s.paid_method) : null,
          debtorName: s.debtor_name,
          artist: an(i.edition_copies.editions.artists),
          title: i.edition_copies.editions.title || 'Без названия',
          copyNumber: i.edition_copies.copy_number,
          framed: i.framed,
          basePrice: i.base_price,
          discount: i.discount,
          finalPrice: i.final_price,
          royalty: i.royalty_amount,
        })
      }
    }
    return out
  }, [sales, showCancelled, branchFilter, buyerFilter, fairFilter, methodFilter, artistFilter, basis, buyerLabel, methodLabel])

  const activeDetails = useMemo(() => details.filter((d) => !d.isCancelled), [details])

  // Итоги: каждый филиал отдельно и все вместе (ТЗ §5.8)
  const branchTotals = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of activeDetails) m.set(d.branch, (m.get(d.branch) ?? 0) + d.finalPrice)
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'))
  }, [activeDetails])
  const grandTotal = activeDetails.reduce((s, d) => s + d.finalPrice, 0)

  // Сводка по способам оплаты — фактические поступления по филиалам
  const methodSummary = useMemo(() => {
    const m = new Map<string, Map<string, number>>()
    for (const d of activeDetails.filter((x) => x.isPaid && x.paidMethod)) {
      if (!m.has(d.paidMethod!)) m.set(d.paidMethod!, new Map())
      const inner = m.get(d.paidMethod!)!
      inner.set(d.branch, (inner.get(d.branch) ?? 0) + d.finalPrice)
    }
    return m
  }, [activeDetails])

  const visibleSales = useMemo(() => {
    const ids = new Set(details.map((d) => d.saleId))
    return (sales ?? []).filter((s) => ids.has(s.id))
  }, [sales, details])

  async function confirmCancel(reason: string) {
    if (!cancelling) return
    setBusy(true)
    const { error: err } = await supabase.rpc('cancel_sale', {
      p_sale_id: cancelling.id,
      p_reason: reason,
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setCancelling(null)
    await loadSales()
  }

  const selCls = 'rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white'

  return (
    <div className="pb-8">
      <h1 className="font-bold text-lg mb-3">Отчёты</h1>

      <div className="flex gap-1 bg-gray-200 rounded-xl p-1 mb-3">
        {(
          [
            ['sales', 'Продажи'],
            ['methods', 'Оплаты'],
            ['stock', 'Остатки'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${
              tab === t ? 'bg-white shadow' : 'text-gray-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="text-red-600 text-sm mb-3" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {tab !== 'stock' && (
        <div className="bg-white rounded-xl p-3 shadow-sm mb-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={selCls} />
            <span className="text-gray-400">—</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={selCls} />
            <div className="flex rounded-lg overflow-hidden border border-gray-300 text-sm">
              <button
                onClick={() => setBasis('sold')}
                className={`px-3 py-1.5 ${basis === 'sold' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
              >
                по продаже
              </button>
              <button
                onClick={() => setBasis('paid')}
                className={`px-3 py-1.5 ${basis === 'paid' ? 'bg-gray-900 text-white' : 'bg-white text-gray-600'}`}
              >
                по оплате
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className={selCls}>
              <option value="">Все филиалы</option>
              {[...new Set((sales ?? []).map((s) => s.branches?.name ?? '?'))].sort().map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <select value={artistFilter} onChange={(e) => setArtistFilter(e.target.value)} className={selCls}>
              <option value="">Все художники</option>
              {artists.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            <select value={buyerFilter} onChange={(e) => setBuyerFilter(e.target.value)} className={selCls}>
              <option value="">Все типы</option>
              {buyerTypes.map((b) => (
                <option key={b.code} value={b.code}>{b.label}</option>
              ))}
            </select>
            <select value={methodFilter} onChange={(e) => setMethodFilter(e.target.value)} className={selCls}>
              <option value="">Все способы</option>
              {methods.map((m) => (
                <option key={m.code} value={m.code}>{m.label}</option>
              ))}
            </select>
            <input
              value={fairFilter}
              onChange={(e) => setFairFilter(e.target.value)}
              placeholder="Ярмарка…"
              className={`${selCls} w-28`}
            />
            <label className="flex items-center gap-1.5 text-sm text-gray-500">
              <input
                type="checkbox"
                checked={showCancelled}
                onChange={(e) => setShowCancelled(e.target.checked)}
              />
              отменённые
            </label>
          </div>
        </div>
      )}

      {tab === 'sales' && (
        <>
          <div className="bg-gray-900 text-white rounded-xl p-4 mb-3">
            <div className="flex items-baseline justify-between">
              <span className="text-gray-300 text-sm">Итого за период</span>
              <span className="text-2xl font-bold">{fmtRub(grandTotal)}</span>
            </div>
            {branchTotals.length > 1 && (
              <div className="mt-2 space-y-1 text-sm">
                {branchTotals.map(([b, sum]) => (
                  <div key={b} className="flex justify-between text-gray-300">
                    <span>{b}</span>
                    <span>{fmtRub(sum)}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="text-xs text-gray-400 mt-2">
              Позиций: {activeDetails.length} · чеков: {visibleSales.filter((s) => !s.is_cancelled).length}
            </div>
          </div>

          <button
            onClick={() => {
              // SheetJS тяжёлый — грузим только при выгрузке
              void import('../export/xlsx')
                .then(({ exportSalesReport }) =>
                  exportSalesReport(details, `Продажи_${from}_${to}.xlsx`),
                )
                .catch((e) => setError(String((e as Error).message ?? e)))
            }}
            disabled={details.length === 0}
            className="w-full mb-3 bg-green-700 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40"
          >
            ⬇️ Выгрузить в Excel
          </button>

          {!sales && <div className="text-gray-400 text-center py-8">Загрузка…</div>}

          <div className="space-y-2">
            {visibleSales.map((s) => (
              <div
                key={s.id}
                className={`rounded-xl p-3 shadow-sm ${
                  s.is_cancelled
                    ? 'bg-white opacity-60'
                    : !s.is_paid
                      ? 'bg-yellow-100' // должник — не оплачено
                      : 'bg-white'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className={`font-semibold ${s.is_cancelled ? 'line-through' : ''}`}>
                    {fmtRub(s.total)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {fmtDate(s.sold_at)} · {s.branches?.name}
                  </div>
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {buyerLabel(s.buyer_type)}
                  {s.fair_name ? ` · ${s.fair_name}` : ''} · {methodLabel(s.payment_method)}
                  {s.is_paid
                    ? s.paid_method && s.paid_method !== s.payment_method
                      ? ` → ${methodLabel(s.paid_method)}`
                      : ''
                    : ` · не оплачен (${s.debtor_name ?? '—'})`}
                  {s.is_cancelled ? ' · ОТМЕНЁН' : ''}
                  {' · продал: '}
                  {sellerNames.get(s.created_by) ?? '—'}
                </div>
                <div className="text-sm text-gray-700 mt-1.5">
                  {s.sale_items.map((i) => (
                    <div key={i.id} className={s.is_cancelled ? 'line-through' : ''}>
                      {an(i.edition_copies.editions.artists)} —{' '}
                      {i.edition_copies.editions.title || 'Без названия'} · №{' '}
                      {i.edition_copies.copy_number} · {i.framed ? 'рамка' : 'без рамки'}
                      {i.discount > 0 ? ` · скидка ${fmtRub(i.discount)}` : ''} ·{' '}
                      <b>{fmtRub(i.final_price)}</b>
                    </div>
                  ))}
                </div>
                {s.comment && (
                  <div className="text-xs text-gray-500 mt-1">Комментарий: {s.comment}</div>
                )}
                {s.is_cancelled && s.cancel_reason && (
                  <div className="text-xs text-red-600 mt-1">
                    Причина отмены: {s.cancel_reason}
                  </div>
                )}
                {!s.is_cancelled && (
                  <button
                    onClick={() => setCancelling(s)}
                    disabled={busy}
                    className="mt-2 text-xs text-red-600 underline disabled:opacity-50"
                  >
                    Отменить чек
                  </button>
                )}
              </div>
            ))}
            {sales && visibleSales.length === 0 && (
              <div className="text-gray-400 text-center py-8">Продаж за период нет</div>
            )}
          </div>
        </>
      )}

      {tab === 'methods' && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500 mb-1">
            Фактические поступления (где искать деньги и в какой кассе). Незакрытые
            постоплаты не учитываются.
          </div>
          {[...methodSummary.entries()].map(([method, branches]) => {
            const total = [...branches.values()].reduce((a, b) => a + b, 0)
            return (
              <div key={method} className="bg-white rounded-xl p-3 shadow-sm">
                <div className="flex justify-between font-semibold">
                  <span>{method}</span>
                  <span>{fmtRub(total)}</span>
                </div>
                <div className="mt-1 space-y-0.5 text-sm text-gray-500">
                  {[...branches.entries()].map(([b, sum]) => (
                    <div key={b} className="flex justify-between">
                      <span>{b}</span>
                      <span>{fmtRub(sum)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
          {methodSummary.size === 0 && (
            <div className="text-gray-400 text-center py-8">Поступлений за период нет</div>
          )}
        </div>
      )}

      {tab === 'stock' && (
        <div className="space-y-2">
          <div className="text-xs text-gray-500 mb-1">
            Подписанные работы в наличии по филиалам
          </div>
          {!stock && <div className="text-gray-400 text-center py-8">Загрузка…</div>}
          {stock &&
            [...new Set(stock.map((s) => s.branch))].map((branch) => {
              const rows = stock.filter((s) => s.branch === branch)
              const total = rows.reduce((a, r) => a + r.count, 0)
              return (
                <div key={branch} className="bg-white rounded-xl p-3 shadow-sm">
                  <div className="flex justify-between font-semibold">
                    <span>{branch}</span>
                    <span>{total} шт.</span>
                  </div>
                  <div className="mt-1 space-y-0.5 text-sm text-gray-500">
                    {rows.map((r) => (
                      <div key={r.artist} className="flex justify-between">
                        <span>{r.artist}</span>
                        <span>{r.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          {stock && stock.length === 0 && (
            <div className="text-gray-400 text-center py-8">Подписанных работ нет</div>
          )}
        </div>
      )}

      {cancelling && (
        <CancelReasonDialog
          saleLabel={`${fmtRub(cancelling.total)} · ${fmtDate(cancelling.sold_at)} · ${cancelling.branches?.name ?? ''}`}
          busy={busy}
          onConfirm={(reason) => void confirmCancel(reason)}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  )
}
