import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { fmtDate, fmtRub } from '../lib/format'
import type { ArtistBalance } from '../types'

interface PayoutRow {
  id: string
  amount: number
  paid_at: string
  comment: string | null
  artists: { name: string } | null
}

/** Начисления и выплаты художникам (ТЗ §5.8, только владелец) */
export default function PayoutsPage() {
  const { session } = useAuth()
  const [balances, setBalances] = useState<ArtistBalance[] | null>(null)
  const [payouts, setPayouts] = useState<PayoutRow[]>([])
  const [payingFor, setPayingFor] = useState<ArtistBalance | null>(null)
  const [amount, setAmount] = useState('')
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [balRes, payRes] = await Promise.all([
      supabase.from('artist_balances').select('*').order('artist_name'),
      supabase
        .from('artist_payouts')
        .select('id, amount, paid_at, comment, artists(name)')
        .order('created_at', { ascending: false })
        .limit(30),
    ])
    if (balRes.error) setError(balRes.error.message)
    else setBalances((balRes.data ?? []) as ArtistBalance[])
    if (payRes.data) setPayouts(payRes.data as unknown as PayoutRow[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  function openPayout(b: ArtistBalance) {
    setPayingFor(b)
    setAmount(b.balance > 0 ? String(b.balance) : '')
    setComment('')
  }

  async function submitPayout() {
    if (!payingFor || !session) return
    const amt = parseFloat(amount.replace(',', '.'))
    if (isNaN(amt) || amt <= 0) {
      setError('Сумма выплаты должна быть больше нуля')
      return
    }
    setBusy(true)
    const { error: err } = await supabase.from('artist_payouts').insert({
      artist_id: payingFor.artist_id,
      amount: amt,
      comment: comment.trim() || null,
      created_by: session.user.id,
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    setPayingFor(null)
    await load()
  }

  if (error && !balances)
    return <div className="text-red-600 text-sm py-4">{error}</div>
  if (!balances) return <div className="text-gray-400 text-center py-10">Загрузка…</div>

  return (
    <div className="pb-8">
      <h1 className="font-bold text-lg mb-3">Начисления художникам</h1>

      {error && (
        <div className="text-red-600 text-sm mb-3" onClick={() => setError(null)}>
          {error}
        </div>
      )}

      <div className="space-y-2">
        {balances.map((b) => (
          <div key={b.artist_id} className="bg-white rounded-xl p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="font-semibold">{b.artist_name}</div>
              <div
                className={`font-bold ${b.balance > 0 ? 'text-red-600' : 'text-green-700'}`}
              >
                {b.balance > 0 ? `долг ${fmtRub(b.balance)}` : 'выплачено'}
              </div>
            </div>
            <div className="text-sm text-gray-500 mt-0.5">
              начислено {fmtRub(b.accrued)} · выплачено {fmtRub(b.paid)}
            </div>
            {b.balance > 0 && (
              <button
                onClick={() => openPayout(b)}
                className="mt-2 text-sm bg-gray-900 text-white rounded-lg px-4 py-2 font-medium"
              >
                Зафиксировать выплату
              </button>
            )}
          </div>
        ))}
      </div>

      <h2 className="font-semibold mt-6 mb-2">Последние выплаты</h2>
      <div className="space-y-1.5">
        {payouts.map((p) => (
          <div key={p.id} className="bg-white rounded-lg px-3 py-2 text-sm flex justify-between shadow-sm">
            <span>
              {p.artists?.name}
              {p.comment ? ` · ${p.comment}` : ''}
            </span>
            <span className="text-gray-500 shrink-0 ml-3">
              {fmtRub(p.amount)} · {fmtDate(p.paid_at)}
            </span>
          </div>
        ))}
        {payouts.length === 0 && (
          <div className="text-gray-400 text-sm">Выплат ещё не было</div>
        )}
      </div>

      {payingFor && (
        <div className="fixed inset-0 z-50" onClick={() => setPayingFor(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl p-4 pb-6 max-w-3xl mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 rounded mx-auto mb-3" />
            <div className="font-semibold text-lg">Выплата: {payingFor.artist_name}</div>
            <div className="text-sm text-gray-500 mt-0.5">
              Текущий долг: {fmtRub(payingFor.balance)}
            </div>
            <label className="block text-sm font-medium text-gray-700 mt-4">
              Сумма, ₽
              <input
                type="number"
                inputMode="numeric"
                min={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base"
              />
            </label>
            <label className="block text-sm font-medium text-gray-700 mt-3">
              Комментарий
              <input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="например: перевод на карту"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2.5 text-base"
              />
            </label>
            <button
              onClick={() => void submitPayout()}
              disabled={busy}
              className="mt-4 w-full bg-gray-900 text-white rounded-xl py-3 font-semibold disabled:opacity-50"
            >
              {busy ? 'Сохранение…' : 'Выплата произведена'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
