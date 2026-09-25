import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { supabase } from '../lib/supabase'
import { fmtRub } from '../lib/format'
import {
  fetchArtists,
  fetchBranches,
  fetchEditionsWithArtists,
  type EditionWithArtist,
} from '../lib/queries'
import type { Artist, Branch, BuyerType, Debtor, PaymentMethod, Role, UserRole } from '../types'

type Tab = 'users' | 'branches' | 'refs' | 'editions'

const ROLE_LABEL: Record<Role, string> = {
  owner: 'Владелец',
  admin: 'Администратор',
  seller: 'Продавец',
}

async function callManageUsers(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('manage-users', { body })
  if (error) {
    // Пытаемся достать текст ошибки из ответа функции
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx) {
        const j = await ctx.json()
        if (j?.error) throw new Error(j.error)
      }
    } catch (e) {
      if (e instanceof Error && e.message) throw e
    }
    throw new Error(error.message ?? 'Ошибка сервера')
  }
  if (data?.error) throw new Error(data.error)
  return data
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white rounded-xl p-3 shadow-sm">
      <div className="font-semibold mb-2">{title}</div>
      {children}
    </div>
  )
}

/** Управление (ТЗ §5.9): владелец — всё; админ — продавцы и справочники */
export default function AdminPage() {
  const { role } = useAuth()
  const isOwner = role === 'owner'
  const [tab, setTab] = useState<Tab>('users')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // --- Сотрудники ---
  const [users, setUsers] = useState<UserRole[] | null>(null)
  const [branches, setBranches] = useState<Branch[]>([])
  const [uLogin, setULogin] = useState('')
  const [uPassword, setUPassword] = useState('')
  const [uRole, setURole] = useState<Role>('seller')
  const [uBranch, setUBranch] = useState('')
  const [uName, setUName] = useState('')
  const [busy, setBusy] = useState(false)

  const loadUsers = useCallback(async () => {
    try {
      const data = await callManageUsers({ action: 'list' })
      setUsers((data?.users ?? []) as UserRole[])
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])

  useEffect(() => {
    void loadUsers()
    fetchBranches().then((b) => {
      setBranches(b)
      setUBranch(b[0]?.id ?? '')
    })
  }, [loadUsers])

  async function createUser() {
    setBusy(true)
    setError(null)
    try {
      await callManageUsers({
        action: 'create',
        login: uLogin,
        password: uPassword,
        role: uRole,
        branch_id: uBranch,
        display_name: uName || null,
      })
      setNotice(`Учётка «${uLogin.trim().toLowerCase()}» создана`)
      setULogin('')
      setUPassword('')
      setUName('')
      await loadUsers()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function deleteUser(u: UserRole) {
    if (!window.confirm(`Удалить учётку «${u.login ?? u.display_name}»?`)) return
    setBusy(true)
    setError(null)
    try {
      await callManageUsers({ action: 'delete', user_id: u.user_id })
      await loadUsers()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // --- Филиалы (владелец) ---
  const [newBranch, setNewBranch] = useState('')

  async function addBranch() {
    if (!newBranch.trim()) return
    const { error: err } = await supabase.from('branches').insert({ name: newBranch.trim() })
    if (err) setError(err.message)
    else {
      setNewBranch('')
      fetchBranches().then(setBranches)
    }
  }

  async function toggleBranch(b: Branch) {
    const { error: err } = await supabase
      .from('branches')
      .update({ is_active: !b.is_active })
      .eq('id', b.id)
    if (err) setError(err.message)
    else fetchBranches().then(setBranches)
  }

  // --- Справочники ---
  const [artists, setArtists] = useState<Artist[]>([])
  const [newArtist, setNewArtist] = useState('')
  const [buyerTypes, setBuyerTypes] = useState<BuyerType[]>([])
  const [newBuyerType, setNewBuyerType] = useState('')
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  const [debtorsList, setDebtorsList] = useState<Debtor[]>([])
  const [newDebtorName, setNewDebtorName] = useState('')
  const [newDebtorContact, setNewDebtorContact] = useState('')

  const loadRefs = useCallback(() => {
    fetchArtists().then(setArtists)
    supabase
      .from('buyer_types')
      .select('*')
      .order('sort_order')
      .then(({ data }) => setBuyerTypes((data ?? []) as BuyerType[]))
    if (isOwner) {
      supabase
        .from('debtors')
        .select('*')
        .order('name')
        .then(({ data }) => setDebtorsList((data ?? []) as Debtor[]))
    }
    if (isOwner) {
      supabase
        .schema('finance')
        .from('payment_methods')
        .select('*')
        .order('sort_order')
        .then(({ data }) => setMethods((data ?? []) as PaymentMethod[]))
    }
  }, [isOwner])

  useEffect(() => {
    if (tab === 'refs') loadRefs()
  }, [tab, loadRefs])

  async function addArtist() {
    if (!newArtist.trim()) return
    const { error: err } = await supabase.from('artists').insert({ name: newArtist.trim() })
    if (err) setError(err.message)
    else {
      setNewArtist('')
      loadRefs()
    }
  }

  async function addBuyerType() {
    const label = newBuyerType.trim()
    if (!label) return
    const code = label
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '')
    const { error: err } = await supabase.from('buyer_types').insert({ code, label })
    if (err) setError(err.message)
    else {
      setNewBuyerType('')
      loadRefs()
    }
  }

  async function toggleBuyerType(bt: BuyerType) {
    const { error: err } = await supabase
      .from('buyer_types')
      .update({ is_active: !bt.is_active })
      .eq('code', bt.code)
    if (err) setError(err.message)
    else loadRefs()
  }

  async function addDebtor() {
    if (!newDebtorName.trim()) return
    const { error: err } = await supabase.from('debtors').insert({
      name: newDebtorName.trim(),
      contact: newDebtorContact.trim() || null,
    })
    if (err) setError(err.message)
    else {
      setNewDebtorName('')
      setNewDebtorContact('')
      loadRefs()
    }
  }

  async function toggleDebtor(d: Debtor) {
    const { error: err } = await supabase
      .from('debtors')
      .update({ is_active: !d.is_active })
      .eq('id', d.id)
    if (err) setError(err.message)
    else loadRefs()
  }

  async function toggleMethod(m: PaymentMethod) {
    const { error: err } = await supabase
      .schema('finance')
      .from('payment_methods')
      .update({ is_active: !m.is_active })
      .eq('code', m.code)
    if (err) setError(err.message)
    else loadRefs()
  }

  // --- Тиражи: цены и роялти (владелец) ---
  const [editions, setEditions] = useState<EditionWithArtist[]>([])
  const [editEdition, setEditEdition] = useState<EditionWithArtist | null>(null)
  const [ePriceU, setEPriceU] = useState('')
  const [ePriceF, setEPriceF] = useState('')
  const [eRoyalty, setERoyalty] = useState('')

  useEffect(() => {
    if (tab === 'editions') fetchEditionsWithArtists().then(setEditions)
  }, [tab])

  function openEdition(e: EditionWithArtist) {
    setEditEdition(e)
    setEPriceU(String(e.price_unframed))
    setEPriceF(String(e.price_framed))
    setERoyalty(String(e.royalty_amount))
  }

  async function saveEdition() {
    if (!editEdition) return
    const { error: err } = await supabase
      .from('editions')
      .update({
        price_unframed: parseFloat(ePriceU) || editEdition.price_unframed,
        price_framed: parseFloat(ePriceF) || editEdition.price_framed,
        royalty_amount: Math.max(0, parseFloat(eRoyalty) || 0),
      })
      .eq('id', editEdition.id)
    if (err) setError(err.message)
    else {
      setNotice('Тираж обновлён (действует на будущие продажи)')
      setEditEdition(null)
      fetchEditionsWithArtists().then(setEditions)
    }
  }

  const inputCls = 'rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white'

  const tabs: [Tab, string][] = [
    ['users', 'Сотрудники'],
    ...(isOwner ? ([['branches', 'Филиалы']] as [Tab, string][]) : []),
    ['refs', 'Справочники'],
    ...(isOwner ? ([['editions', 'Цены/роялти']] as [Tab, string][]) : []),
  ]

  return (
    <div className="pb-8">
      <h1 className="font-bold text-lg mb-3">Управление</h1>

      <div className="flex gap-1 bg-gray-200 rounded-xl p-1 mb-3 overflow-x-auto">
        {tabs.map(([t, label]) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium ${
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
      {notice && (
        <div
          className="bg-green-50 border border-green-300 text-green-800 text-sm rounded-lg px-3 py-2 mb-3"
          onClick={() => setNotice(null)}
        >
          {notice}
        </div>
      )}

      {tab === 'users' && (
        <div className="space-y-3">
          <Section title="Новый сотрудник">
            <div className="grid grid-cols-2 gap-2">
              <input value={uLogin} onChange={(e) => setULogin(e.target.value)} placeholder="Логин" autoCapitalize="none" className={inputCls} />
              <input value={uPassword} onChange={(e) => setUPassword(e.target.value)} placeholder="Пароль (мин. 6)" className={inputCls} />
              <select value={uRole} onChange={(e) => setURole(e.target.value as Role)} className={inputCls}>
                <option value="seller">Продавец</option>
                {isOwner && <option value="admin">Администратор</option>}
              </select>
              <select value={uBranch} onChange={(e) => setUBranch(e.target.value)} className={inputCls}>
                {branches.filter((b) => b.is_active).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
              <input value={uName} onChange={(e) => setUName(e.target.value)} placeholder="Имя (для отображения)" className={`${inputCls} col-span-2`} />
            </div>
            <button
              onClick={() => void createUser()}
              disabled={busy || !uLogin.trim() || uPassword.length < 6 || !uBranch}
              className="mt-2 w-full bg-gray-900 text-white rounded-lg py-2.5 text-sm font-semibold disabled:opacity-40"
            >
              {busy ? '…' : 'Создать учётку'}
            </button>
          </Section>

          <Section title="Сотрудники">
            {!users && <div className="text-gray-400 text-sm">Загрузка…</div>}
            <div className="space-y-1.5">
              {(users ?? []).map((u) => {
                const branch = branches.find((b) => b.id === u.branch_id)
                const canDelete =
                  u.role !== 'owner' && (isOwner || u.role === 'seller')
                return (
                  <div key={u.user_id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                    <div>
                      <span className="font-medium">{u.display_name || u.login}</span>
                      <span className="text-gray-400"> · {u.login}</span>
                      <div className="text-xs text-gray-500">
                        {ROLE_LABEL[u.role]}
                        {branch ? ` · ${branch.name}` : ''}
                      </div>
                    </div>
                    {canDelete && (
                      <button
                        onClick={() => void deleteUser(u)}
                        disabled={busy}
                        className="text-red-600 text-xs underline disabled:opacity-50"
                      >
                        удалить
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </Section>
        </div>
      )}

      {tab === 'branches' && isOwner && (
        <Section title="Филиалы">
          <div className="flex gap-2 mb-3">
            <input value={newBranch} onChange={(e) => setNewBranch(e.target.value)} placeholder="Название филиала" className={`${inputCls} flex-1`} />
            <button onClick={() => void addBranch()} className="bg-gray-900 text-white rounded-lg px-4 text-sm font-semibold">
              +
            </button>
          </div>
          <div className="space-y-1.5">
            {branches.map((b) => (
              <div key={b.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                <span className={b.is_active ? '' : 'text-gray-400 line-through'}>{b.name}</span>
                <button onClick={() => void toggleBranch(b)} className="text-xs text-gray-500 underline">
                  {b.is_active ? 'скрыть' : 'вернуть'}
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}

      {tab === 'refs' && (
        <div className="space-y-3">
          <Section title="Художники">
            <div className="flex gap-2 mb-3">
              <input value={newArtist} onChange={(e) => setNewArtist(e.target.value)} placeholder="Имя художника" className={`${inputCls} flex-1`} />
              <button onClick={() => void addArtist()} className="bg-gray-900 text-white rounded-lg px-4 text-sm font-semibold">
                +
              </button>
            </div>
            <div className="text-sm text-gray-600">
              {artists.map((a) => a.name).join(', ') || 'пока пусто'}
            </div>
          </Section>

          <Section title="Типы покупателей">
            <div className="flex gap-2 mb-3">
              <input value={newBuyerType} onChange={(e) => setNewBuyerType(e.target.value)} placeholder="Например: Дизайнер" className={`${inputCls} flex-1`} />
              <button onClick={() => void addBuyerType()} className="bg-gray-900 text-white rounded-lg px-4 text-sm font-semibold">
                +
              </button>
            </div>
            <div className="space-y-1.5">
              {buyerTypes.map((bt) => (
                <div key={bt.code} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                  <span className={bt.is_active ? '' : 'text-gray-400 line-through'}>{bt.label}</span>
                  <button onClick={() => void toggleBuyerType(bt)} className="text-xs text-gray-500 underline">
                    {bt.is_active ? 'скрыть' : 'вернуть'}
                  </button>
                </div>
              ))}
            </div>
          </Section>

          {isOwner && (
            <Section title="Должники (постоплата)">
              <div className="grid grid-cols-2 gap-2 mb-2">
                <input value={newDebtorName} onChange={(e) => setNewDebtorName(e.target.value)} placeholder="Название / имя" className={inputCls} />
                <input value={newDebtorContact} onChange={(e) => setNewDebtorContact(e.target.value)} placeholder="Контакт (необязательно)" className={inputCls} />
              </div>
              <button
                onClick={() => void addDebtor()}
                disabled={!newDebtorName.trim()}
                className="w-full bg-gray-900 text-white rounded-lg py-2 text-sm font-semibold disabled:opacity-40 mb-3"
              >
                Добавить должника
              </button>
              <div className="space-y-1.5">
                {debtorsList.map((d) => (
                  <div key={d.id} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                    <span className={d.is_active ? '' : 'text-gray-400 line-through'}>
                      {d.name}
                      {d.contact ? <span className="text-gray-400"> · {d.contact}</span> : ''}
                    </span>
                    <button onClick={() => void toggleDebtor(d)} className="text-xs text-gray-500 underline shrink-0 ml-2">
                      {d.is_active ? 'скрыть' : 'вернуть'}
                    </button>
                  </div>
                ))}
                {debtorsList.length === 0 && (
                  <div className="text-sm text-gray-400">Пока пусто — должники также создаются при оформлении постоплаты</div>
                )}
              </div>
            </Section>
          )}

          {isOwner && (
            <Section title="Способы оплаты">
              <div className="space-y-1.5">
                {methods.map((m) => (
                  <div key={m.code} className="flex items-center justify-between text-sm py-1 border-b border-gray-100 last:border-0">
                    <span className={m.is_active ? '' : 'text-gray-400 line-through'}>
                      {m.label}
                      {m.is_deferred ? ' (отложенный)' : ''}
                    </span>
                    <button onClick={() => void toggleMethod(m)} className="text-xs text-gray-500 underline">
                      {m.is_active ? 'скрыть' : 'вернуть'}
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}

      {tab === 'editions' && isOwner && (
        <Section title="Цены и роялти тиражей">
          <div className="text-xs text-gray-500 mb-2">
            Изменения действуют только на будущие продажи (роялти в оформленных
            чеках зафиксировано).
          </div>
          <div className="space-y-1.5">
            {editions.map((e) => (
              <button
                key={e.id}
                onClick={() => openEdition(e)}
                className="w-full flex items-center justify-between text-sm py-1.5 border-b border-gray-100 last:border-0 text-left"
              >
                <span className="min-w-0 truncate">
                  {e.artists.name} — {e.title || 'Без названия'}
                </span>
                <span className="text-gray-500 shrink-0 ml-2">
                  {fmtRub(e.price_unframed)}/{fmtRub(e.price_framed)} · роялти{' '}
                  {fmtRub(e.royalty_amount)}
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {editEdition && (
        <div className="fixed inset-0 z-50" onClick={() => setEditEdition(null)}>
          <div className="absolute inset-0 bg-black/50" />
          <div
            className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl p-4 pb-6 max-w-3xl mx-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 rounded mx-auto mb-3" />
            <div className="font-semibold">
              {editEdition.artists.name} — {editEdition.title || 'Без названия'}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              <label className="text-xs text-gray-500">
                Без рамки, ₽
                <input type="number" value={ePriceU} onChange={(e) => setEPriceU(e.target.value)} className={`${inputCls} w-full mt-1`} />
              </label>
              <label className="text-xs text-gray-500">
                С рамкой, ₽
                <input type="number" value={ePriceF} onChange={(e) => setEPriceF(e.target.value)} className={`${inputCls} w-full mt-1`} />
              </label>
              <label className="text-xs text-gray-500">
                Роялти, ₽
                <input type="number" value={eRoyalty} onChange={(e) => setERoyalty(e.target.value)} className={`${inputCls} w-full mt-1`} />
              </label>
            </div>
            <button
              onClick={() => void saveEdition()}
              className="mt-4 w-full bg-gray-900 text-white rounded-xl py-3 font-semibold"
            >
              Сохранить
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
