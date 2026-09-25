import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtRub } from '../lib/format'
import { fetchPaymentMethods } from '../lib/queries'
import type { PaymentMethod } from '../types'

interface DebtorSale {
  id: string
  sold_at: string
  debtor_name: string | null
  debtor_contact: string | null
  total: number
  branches: { name: string } | null
  sale_items: {
    final_price: number
    edition_copies: {
      copy_number: number
      editions: { title: string | null; artists: { name: string } | { name: string }[] }
    }
  }[]
}

const an = (a: { name: string } | { name: string }[]) =>
  Array.isArray(a) ? (a[0]?.name ?? '') : a.name

/** Должники (ТЗ §5.7, только владелец): незакрытые постоплаты */
export default function DebtorsPage() {
  const [rows, setRows] = useState<DebtorSale[] | null>(null)
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [closing, setClosing] = useState<string | null>(null) // sale id, для которого открыт выбор способа
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('sales')
      .select(
        `id, sold_at, debtor_name, debtor_contact, total, branches(name),
         sale_items(final_price, edition_copies(copy_number, editions(title, artists(name))))`,
      )
      .eq('is_paid', false)
      .eq('is_cancelled', false)
      .order('sold_at', { ascending: true })
    if (err) setError(err.message)
    else setRows((data ?? []) as unknown as DebtorSale[])
  }, [])

  useEffect(() => {
    void load()
    fetchPaymentMethods().then((pm) => setMethods(pm.filter((m) => !m.is_deferred)))
  }, [load])

  async function confirm(saleId: string, method: string) {
    setBusy(true)
    const { error: err } = await supabase.rpc('confirm_payment', {
      p_sale_id: saleId,
      p_paid_method: method,
    })
    setBusy(false)
    setClosing(null)
    if (err) setError(err.message)
    else await load()
  }

  if (error) return <div className="text-red-600 text-sm py-4">{error}</div>
  if (!rows) return <div className="text-gray-400 text-center py-10">Загрузка…</div>

  const totalDebt = rows.reduce((s, r) => s + r.total, 0)

  return (
    <div className="pb-8">
      <h1 className="font-bold text-lg mb-1">Должники</h1>
      <div className="text-sm text-gray-500 mb-3">
        Незакрытых постоплат: {rows.length} на {fmtRub(totalDebt)}
      </div>

      {rows.length === 0 && (
        <div className="text-gray-400 text-center py-12">Долгов нет 🎉</div>
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="bg-white rounded-xl p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{r.debtor_name || 'Без имени'}</div>
              <div className="font-bold">{fmtRub(r.total)}</div>
            </div>
            <div className="text-sm text-gray-500">
              {r.debtor_contact} · чек от {fmtDate(r.sold_at)} · {r.branches?.name}
            </div>
            <div className="text-sm text-gray-600 mt-2">
              {r.sale_items.map((i, idx) => (
                <div key={idx}>
                  {an(i.edition_copies.editions.artists)} —{' '}
                  {i.edition_copies.editions.title || 'Без названия'} · №{' '}
                  {i.edition_copies.copy_number} · {fmtRub(i.final_price)}
                </div>
              ))}
            </div>

            {closing === r.id ? (
              <div className="mt-3">
                <div className="text-sm font-medium mb-1.5">
                  Как фактически получены деньги?
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {methods.map((m) => (
                    <button
                      key={m.code}
                      disabled={busy}
                      onClick={() => void confirm(r.id, m.code)}
                      className="py-2 rounded-lg border border-gray-300 text-sm font-medium disabled:opacity-50"
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => setClosing(null)}
                  className="mt-2 text-sm text-gray-400 underline"
                >
                  Отмена
                </button>
              </div>
            ) : (
              <button
                onClick={() => setClosing(r.id)}
                className="mt-3 w-full bg-green-600 text-white rounded-lg py-2.5 text-sm font-semibold"
              >
                Оплата получена
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
