import { useCallback, useEffect, useMemo, useState } from 'react'
import ArtImage from '../components/ArtImage'
import { supabase } from '../lib/supabase'
import { fmtDate } from '../lib/format'

interface QueueRow {
  item_id: string
  sold_at: string
  artist_name: string
  title: string
  copy_number: number
  framed: boolean
  branch_name: string
  image_path: string | null
}

/**
 * Очередь «К печати» (ТЗ §5.5) — проданные номера, требующие печати и
 * подписи. Без денежных полей (RPC их не возвращает). Фильтр по филиалу.
 */
export default function ProductionQueuePage() {
  const [rows, setRows] = useState<QueueRow[] | null>(null)
  const [branchFilter, setBranchFilter] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data, error: err } = await supabase.rpc('production_queue')
    if (err) setError(err.message)
    else setRows((data ?? []) as QueueRow[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const branches = useMemo(
    () => [...new Set((rows ?? []).map((r) => r.branch_name))].sort(),
    [rows],
  )
  const visible = useMemo(
    () => (rows ?? []).filter((r) => !branchFilter || r.branch_name === branchFilter),
    [rows, branchFilter],
  )

  async function markDone(itemId: string) {
    setBusyId(itemId)
    const { error: err } = await supabase.rpc('mark_produced', { p_item_id: itemId })
    setBusyId(null)
    if (err) setError(err.message)
    else await load()
  }

  if (error) return <div className="text-red-600 text-sm py-4">{error}</div>
  if (!rows) return <div className="text-gray-400 text-center py-10">Загрузка…</div>

  return (
    <div className="pb-8">
      <div className="flex items-center justify-between mb-3">
        <h1 className="font-bold text-lg">К печати</h1>
        {branches.length > 1 && (
          <select
            value={branchFilter}
            onChange={(e) => setBranchFilter(e.target.value)}
            className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
          >
            <option value="">Все филиалы</option>
            {branches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        )}
      </div>

      {visible.length === 0 && (
        <div className="text-gray-400 text-center py-12">
          Очередь пуста — всё отпечатано и подписано 🎉
        </div>
      )}

      <div className="space-y-2">
        {visible.map((r) => (
          <div key={r.item_id} className="bg-white rounded-xl p-3 shadow-sm flex items-center gap-3">
            <ArtImage
              path={r.image_path}
              alt={r.title}
              className="w-12 h-12 rounded-lg shrink-0"
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium truncate">
                {r.artist_name} — {r.title}
              </div>
              <div className="text-sm text-gray-500">
                № {r.copy_number} · {r.framed ? 'с рамкой' : 'без рамки'} · продан{' '}
                {fmtDate(r.sold_at)}
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                Печать и выдача: {r.branch_name}
              </div>
            </div>
            <button
              onClick={() => void markDone(r.item_id)}
              disabled={busyId === r.item_id}
              className="shrink-0 bg-green-600 text-white rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
            >
              {busyId === r.item_id ? '…' : 'Готово'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
