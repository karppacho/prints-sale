import { useCallback, useEffect, useState } from 'react'
import ArtImage from '../components/ArtImage'
import CancelReasonDialog from '../components/CancelReasonDialog'
import { supabase } from '../lib/supabase'
import { fmtDateTime, fmtRub } from '../lib/format'
import { fetchPaymentMethods, fetchSalesForCancel } from '../lib/queries'
import type { CancelSaleRow, PaymentMethod } from '../types'

const PAGE = 100

/**
 * Отмена чеков (продавец/админ — свой филиал, владелец — все филиалы).
 * Отдельный экран без общей сводки продаж: список чеков с миниатюрами,
 * продавцом и комментарием. Причина отмены обязательна — руководитель
 * видит её в отчёте.
 */
export default function CancelSalesPage() {
  const [rows, setRows] = useState<CancelSaleRow[] | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [cancelling, setCancelling] = useState<CancelSaleRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (offset: number) => {
    try {
      const batch = await fetchSalesForCancel(PAGE, offset)
      setRows((prev) => (offset === 0 ? batch : [...(prev ?? []), ...batch]))
      setHasMore(batch.length === PAGE)
    } catch (e) {
      setError((e as Error).message ?? String(e))
    }
  }, [])

  useEffect(() => {
    void load(0)
    fetchPaymentMethods().then(setMethods).catch(() => {})
  }, [load])

  const methodLabel = (code: string) =>
    methods.find((m) => m.code === code)?.label ?? code

  async function confirmCancel(reason: string) {
    if (!cancelling) return
    setBusy(true)
    setError(null)
    const { error: err } = await supabase.rpc('cancel_sale', {
      p_sale_id: cancelling.sale_id,
      p_reason: reason,
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setCancelling(null)
    await load(0)
  }

  if (error && !rows) return <div className="text-red-600 text-sm py-4">{error}</div>
  if (!rows) return <div className="text-gray-400 text-center py-10">Загрузка…</div>

  return (
    <div className="pb-8">
      <h1 className="font-bold text-lg mb-3">Отмена чека</h1>

      {error && (
        <div className="text-red-600 text-sm mb-3" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      {rows.length === 0 && (
        <div className="text-gray-400 text-center py-12">Чеков пока нет</div>
      )}

      <div className="space-y-2">
        {rows.map((s) => (
          <div
            key={s.sale_id}
            className={`bg-white rounded-xl p-3 shadow-sm ${s.is_cancelled ? 'opacity-60' : ''}`}
          >
            <div className="flex items-center justify-between">
              <div className={`font-semibold ${s.is_cancelled ? 'line-through' : ''}`}>
                {fmtRub(s.total)}
              </div>
              <div className="text-xs text-gray-500">{fmtDateTime(s.sold_at)}</div>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              {s.seller_name} · {methodLabel(s.payment_method)}
              {!s.is_paid && !s.is_cancelled ? ' · не оплачен' : ''}
              {s.is_cancelled ? ' · ОТМЕНЁН' : ''}
            </div>

            <div className="mt-2 space-y-1.5">
              {(s.items ?? []).map((it, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <ArtImage
                    path={it.image_path}
                    alt={it.title}
                    className="w-10 h-10 rounded-md shrink-0"
                  />
                  <div
                    className={`text-sm text-gray-700 min-w-0 ${s.is_cancelled ? 'line-through' : ''}`}
                  >
                    {it.artist_name} — {it.title} · № {it.copy_number} ·{' '}
                    {it.framed ? 'рамка' : 'без рамки'}
                  </div>
                </div>
              ))}
            </div>

            {s.sale_comment && (
              <div className="text-xs text-gray-500 mt-1.5">
                Комментарий: {s.sale_comment}
              </div>
            )}
            {s.is_cancelled && s.cancel_reason && (
              <div className="text-xs text-red-600 mt-1">
                Причина отмены: {s.cancel_reason}
              </div>
            )}

            {!s.is_cancelled && (
              <button
                onClick={() => setCancelling(s)}
                className="mt-2 text-xs text-red-600 underline"
              >
                Отменить чек
              </button>
            )}
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => void load(rows.length)}
          className="mt-3 w-full py-2.5 rounded-xl border border-gray-300 text-sm font-medium"
        >
          Показать ещё
        </button>
      )}

      {cancelling && (
        <CancelReasonDialog
          saleLabel={`${fmtRub(cancelling.total)} · ${fmtDateTime(cancelling.sold_at)} · ${cancelling.seller_name}`}
          busy={busy}
          onConfirm={(reason) => void confirmCancel(reason)}
          onClose={() => setCancelling(null)}
        />
      )}
    </div>
  )
}
