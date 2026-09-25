import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { fetchBranches } from '../lib/queries'
import { branchAbbr, fmtDateTime } from '../lib/format'
import type { Branch } from '../types'

interface SignedCopyRow {
  id: string
  copy_number: number
  branch_id: string
  editions: {
    id: string
    title: string | null
    edition_size: number
    artists: { name: string } | { name: string }[]
  }
}

interface HistoryRow {
  id: string
  sent_at: string
  sent_by: string
  comment: string | null
  from: { name: string } | null
  to: { name: string } | null
  transfer_items: {
    edition_copies: {
      copy_number: number
      editions: { title: string | null; artists: { name: string } | { name: string }[] }
    }
  }[]
}

function artistName(a: { name: string } | { name: string }[]): string {
  return Array.isArray(a) ? (a[0]?.name ?? '') : a.name
}

/** Перемещения между филиалами (ТЗ §5.5а): оформление + история */
export default function TransfersPage() {
  const { role, branchId: myBranchId } = useAuth()
  const isStaff = role === 'admin' || role === 'owner'

  const [tab, setTab] = useState<'create' | 'history'>('create')
  const [branches, setBranches] = useState<Branch[]>([])
  const [sourceBranch, setSourceBranch] = useState<string>('')
  const [targetBranch, setTargetBranch] = useState<string>('')
  const [copiesInBranch, setCopiesInBranch] = useState<SignedCopyRow[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[] | null>(null)
  const [staffNames, setStaffNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    fetchBranches().then((b) => {
      setBranches(b)
      // Продавец отправляет только из своего филиала
      setSourceBranch(role === 'seller' ? (myBranchId ?? '') : (myBranchId ?? b[0]?.id ?? ''))
    })
  }, [role, myBranchId])

  const loadCopies = useCallback(async () => {
    if (!sourceBranch) return
    setCopiesInBranch(null)
    const { data, error } = await supabase
      .from('edition_copies')
      .select('id, copy_number, branch_id, editions(id, title, edition_size, artists(name))')
      .eq('status', 'signed')
      .eq('branch_id', sourceBranch)
    if (error) {
      setMessage(error.message)
      return
    }
    setCopiesInBranch((data ?? []) as unknown as SignedCopyRow[])
    setSelected(new Set())
  }, [sourceBranch])

  useEffect(() => {
    void loadCopies()
  }, [loadCopies])

  const loadHistory = useCallback(async () => {
    const [{ data, error }, rolesRes] = await Promise.all([
      supabase
        .from('transfers')
        .select(
          `id, sent_at, sent_by, comment,
           from:branches!transfers_from_branch_id_fkey(name),
           to:branches!transfers_to_branch_id_fkey(name),
           transfer_items(edition_copies(copy_number, editions(title, artists(name))))`,
        )
        .order('sent_at', { ascending: false })
        .limit(100),
      supabase.from('user_roles').select('user_id, display_name'),
    ])
    if (error) {
      setMessage(error.message)
      return
    }
    setHistory((data ?? []) as unknown as HistoryRow[])
    if (rolesRes.data) {
      setStaffNames(
        new Map(
          rolesRes.data.map((r) => [r.user_id as string, (r.display_name as string) ?? '']),
        ),
      )
    }
  }, [])

  useEffect(() => {
    if (tab === 'history' && !history) void loadHistory()
  }, [tab, history, loadHistory])

  // Группировка выбираемых экземпляров по тиражу
  const grouped = useMemo(() => {
    const m = new Map<string, { title: string; copies: SignedCopyRow[] }>()
    for (const c of copiesInBranch ?? []) {
      const key = c.editions.id
      const title = `${artistName(c.editions.artists)} — ${c.editions.title || 'Без названия'}`
      if (!m.has(key)) m.set(key, { title, copies: [] })
      m.get(key)!.copies.push(c)
    }
    for (const g of m.values()) g.copies.sort((a, b) => a.copy_number - b.copy_number)
    return [...m.values()]
  }, [copiesInBranch])

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function submit() {
    if (selected.size === 0 || !targetBranch) return
    setBusy(true)
    const { error } = await supabase.rpc('send_transfer', {
      p_copy_ids: [...selected],
      p_to_branch_id: targetBranch,
      p_comment: comment || null,
    })
    setBusy(false)
    if (error) {
      setMessage(error.message)
      return
    }
    setMessage('Перемещение оформлено — экземпляры уже числятся в новом филиале')
    setComment('')
    setTargetBranch('')
    setHistory(null)
    await loadCopies()
  }

  return (
    <div className="pb-24">
      <h1 className="font-bold text-lg mb-3">Перемещения</h1>

      {isStaff && (
        <div className="flex gap-1 bg-gray-200 rounded-xl p-1 mb-3">
          {(['create', 'history'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-1.5 rounded-lg text-sm font-medium ${
                tab === t ? 'bg-white shadow' : 'text-gray-500'
              }`}
            >
              {t === 'create' ? 'Оформить' : 'История'}
            </button>
          ))}
        </div>
      )}

      {message && (
        <div
          className="bg-gray-900 text-white text-sm rounded-lg px-3 py-2 mb-3"
          onClick={() => setMessage(null)}
        >
          {message}
        </div>
      )}

      {tab === 'create' && (
        <div>
          <div className="flex items-center gap-2 text-sm mb-3">
            <span className="text-gray-500 shrink-0">Откуда:</span>
            <select
              value={sourceBranch}
              onChange={(e) => setSourceBranch(e.target.value)}
              disabled={role === 'seller'}
              className="flex-1 rounded-lg border border-gray-300 px-2 py-2 bg-white disabled:bg-gray-100"
            >
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>

          {!copiesInBranch && <div className="text-gray-400 text-center py-8">Загрузка…</div>}
          {copiesInBranch && grouped.length === 0 && (
            <div className="text-gray-400 text-center py-8">
              В этом филиале нет подписанных экземпляров
            </div>
          )}

          <div className="space-y-3">
            {grouped.map((g) => (
              <div key={g.title} className="bg-white rounded-xl p-3 shadow-sm">
                <div className="font-medium text-sm mb-2">{g.title}</div>
                <div className="flex flex-wrap gap-2">
                  {g.copies.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => toggle(c.id)}
                      className={`w-11 h-11 rounded-lg border-2 text-sm font-semibold ${
                        selected.has(c.id)
                          ? 'bg-gray-900 border-gray-900 text-white'
                          : 'bg-green-500 border-green-600 text-white'
                      }`}
                    >
                      {c.copy_number}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {selected.size > 0 && (
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
                    .filter((b) => b.id !== sourceBranch)
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
                onClick={() => void submit()}
                className="w-full py-2.5 rounded-lg bg-gray-900 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? 'Оформление…' : `Переместить ${selected.size} шт.`}
              </button>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-3">
          {!history && <div className="text-gray-400 text-center py-8">Загрузка…</div>}
          {history && history.length === 0 && (
            <div className="text-gray-400 text-center py-8">Перемещений ещё не было</div>
          )}
          {(history ?? []).map((h) => (
            <div key={h.id} className="bg-white rounded-xl p-3 shadow-sm text-sm">
              <div className="flex items-center justify-between">
                <span className="font-semibold">
                  {branchAbbr(h.from?.name ?? '?')} → {branchAbbr(h.to?.name ?? '?')}
                </span>
                <span className="text-gray-500 text-xs">{fmtDateTime(h.sent_at)}</span>
              </div>
              <div className="text-gray-600 mt-1">
                {h.transfer_items.map((ti, i) => {
                  const ec = ti.edition_copies
                  return (
                    <div key={i}>
                      {artistName(ec.editions.artists)} — {ec.editions.title || 'Без названия'} · №{' '}
                      {ec.copy_number}
                    </div>
                  )
                })}
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {staffNames.get(h.sent_by) || 'сотрудник'}
                {h.comment ? ` · ${h.comment}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
