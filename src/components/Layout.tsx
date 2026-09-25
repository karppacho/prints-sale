import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useShift } from '../auth/ShiftContext'
import { useCart } from '../cart/CartContext'
import { useOnline } from '../lib/useOnline'
import { supabase } from '../lib/supabase'
import { APP_NAME } from '../lib/config'

interface NavItem {
  to: string
  label: string
  icon: string
}

const MORE_ITEMS: Record<string, NavItem[]> = {
  seller: [], // «Отмена чека» у продавца — в основной панели
  admin: [
    { to: '/intake', label: 'Приход', icon: '📦' },
    { to: '/transfers', label: 'Перемещения', icon: '🚚' },
    { to: '/cancel-sales', label: 'Отмена чека', icon: '↩️' },
    { to: '/admin', label: 'Управление', icon: '⚙️' },
  ],
  owner: [
    { to: '/intake', label: 'Приход', icon: '📦' },
    { to: '/transfers', label: 'Перемещения', icon: '🚚' },
    { to: '/cancel-sales', label: 'Отмена чека', icon: '↩️' },
    { to: '/debtors', label: 'Должники', icon: '🧾' },
    { to: '/payouts', label: 'Выплаты', icon: '💸' },
    { to: '/admin', label: 'Управление', icon: '⚙️' },
  ],
}

export default function Layout() {
  const { role, branchName, displayName, login, signOut } = useAuth()
  const { mode, fairName } = useShift()
  const { items } = useCart()
  const online = useOnline()
  const location = useLocation()
  const [moreOpen, setMoreOpen] = useState(false)
  const [queueCount, setQueueCount] = useState(0)

  const isStaff = role === 'admin' || role === 'owner'

  // Бейдж очереди «К печати» (админ/владелец)
  useEffect(() => {
    if (!isStaff) return
    supabase
      .rpc('production_queue')
      .then(({ data }) => setQueueCount(Array.isArray(data) ? data.length : 0))
  }, [isStaff, location.pathname])

  useEffect(() => setMoreOpen(false), [location.pathname])

  const mainNav: NavItem[] = [
    { to: '/', label: 'Каталог', icon: '🖼️' },
    { to: '/cart', label: 'Корзина', icon: '🛒' },
    ...(role === 'seller'
      ? [
          { to: '/transfers', label: 'Перемещения', icon: '🚚' },
          { to: '/cancel-sales', label: 'Отмена чека', icon: '↩️' },
        ]
      : [{ to: '/queue', label: 'К печати', icon: '🖨️' }]),
    ...(role === 'owner' ? [{ to: '/reports', label: 'Отчёты', icon: '📊' }] : []),
  ]
  const moreNav = MORE_ITEMS[role ?? 'seller'] ?? []

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="sticky top-0 z-30 bg-gray-900 text-white shadow">
        {!online && (
          <div className="bg-red-600 text-center text-sm py-1 font-medium">
            Нет связи — чеки сохраняются локально
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="min-w-0">
            <div className="font-semibold leading-tight truncate">{APP_NAME}</div>
            <div className="text-xs text-gray-300 truncate">
              {displayName || login}
              {branchName ? ` · ${branchName}` : ''}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link
              to="/shift"
              className={`text-xs px-2.5 py-1.5 rounded-full font-medium ${
                mode === 'fair' ? 'bg-amber-500 text-black' : 'bg-gray-700'
              }`}
            >
              {mode === 'fair' ? `Ярмарка: ${fairName}` : 'Магазин'}
            </Link>
            <button
              onClick={() => void signOut()}
              className="text-xs px-2.5 py-1.5 rounded-full bg-gray-700"
              title="Выйти"
            >
              Выход
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-3 py-3">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200">
        <div className="max-w-3xl mx-auto grid auto-cols-fr grid-flow-col">
          {mainNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `relative flex flex-col items-center py-2 text-[11px] ${
                  isActive ? 'text-gray-900 font-semibold' : 'text-gray-400'
                }`
              }
            >
              <span className="text-lg leading-none">{item.icon}</span>
              <span className="mt-0.5">{item.label}</span>
              {item.to === '/cart' && items.length > 0 && (
                <span className="absolute top-0.5 right-1/2 translate-x-4 bg-red-600 text-white text-[10px] rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                  {items.length}
                </span>
              )}
              {item.to === '/queue' && queueCount > 0 && (
                <span className="absolute top-0.5 right-1/2 translate-x-4 bg-amber-500 text-black text-[10px] rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">
                  {queueCount}
                </span>
              )}
            </NavLink>
          ))}
          {moreNav.length > 0 && (
            <button
              onClick={() => setMoreOpen(true)}
              className="flex flex-col items-center py-2 text-[11px] text-gray-400"
            >
              <span className="text-lg leading-none">☰</span>
              <span className="mt-0.5">Ещё</span>
            </button>
          )}
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setMoreOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute bottom-0 inset-x-0 bg-white rounded-t-2xl p-4 pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-gray-300 rounded mx-auto mb-3" />
            <div className="grid grid-cols-3 gap-3">
              {moreNav.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className="flex flex-col items-center gap-1 py-3 rounded-xl bg-gray-50 text-sm text-gray-700"
                >
                  <span className="text-2xl">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
